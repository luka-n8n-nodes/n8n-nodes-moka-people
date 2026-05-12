import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';
import type { Readable } from 'stream';
import type FormDataType from 'form-data';
import { Credentials, MokaSuccessCodes } from '../type/enums';
import { buildStringToSign, generateNonce, rsaSign } from './sign';

/**
 * Moka People API 标准响应。
 */
export interface IMokaResponse<T = unknown> {
	code: number;
	msg?: string;
	data: T;
}

/**
 * Moka 业务错误：HTTP 2xx 但 `code` 不在 `successCodes` 内。
 *
 * 仅在 `mokaRequest` 内部短暂存在 —— catch 块会把它转换为带原始响应体的
 * `NodeApiError` 抛给 n8n。导出便于做 `instanceof` 判断 / 单元测试。
 */
export class MokaApiError extends Error {
	constructor(
		public readonly code: number,
		public readonly msg: string,
		public readonly raw: IMokaResponse<unknown>,
	) {
		super(`Moka API ${code}: ${msg || '<empty msg>'}`);
		this.name = 'MokaApiError';
	}
}

/**
 * Moka API 调用入参。
 *
 * payload 字段（body / formData / binary / rawData）互斥，优先级：
 *   `binary` > `formData` > `rawData` > `body`。
 * 推荐使用前三种之一，`rawData` 保留向后兼容。
 */
export interface IMokaRequestOptions {
	method?: IHttpRequestMethods;
	/** 业务接口路径，例如 '/v1/batch/data' */
	path: string;
	/** 接口编码（必填），由各节点自行从用户输入收集后传入 */
	apiCode: string;
	/** 调用账号 userName（邮箱），仅当此值非空时才会参与签名并加入 Query */
	userName?: string;
	/** 请求超时时间（毫秒）。0 / undefined 表示沿用 n8n httpRequest 默认超时 */
	timeout?: number;
	/**
	 * 额外的查询参数（会一并参与签名）。
	 * 注意：**禁止**覆盖框架自动注入的字段（entCode / apiCode / userName / nonce / timestamp / sign），
	 * 传入这些 key 会直接抛 NodeOperationError。
	 * `undefined` / `null` 值会被自动过滤；boolean 会被转换为 `'true'` / `'false'`。
	 */
	extraQuery?: Record<string, string | number | boolean | undefined | null>;
	/** 额外的请求头，会与默认 Authorization / Content-Type 合并并覆盖同名 key */
	extraHeaders?: Record<string, string>;
	/** 当前 item 序号（来自 execute 循环），错误时携带在 NodeApiError 上方便 n8n UI 红点定位 */
	itemIndex?: number;
	/** 业务成功 code 列表，默认 [0, 200]；个别接口可以自定义 */
	successCodes?: ReadonlyArray<number>;
	/**
	 * true 时返回完整 `IMokaResponse<T>`（含 `msg` / `request_id` 等），
	 * 默认仅返回 `data` 节点。
	 */
	returnFullResponse?: boolean;

	// ---------- 请求体（互斥）----------
	/** JSON 请求体，自动 application/json，n8n 自动序列化 */
	body?: IDataObject;
	/** multipart/form-data 请求体；Content-Type / boundary 会从 FormData 实例自动注入 */
	formData?: FormDataType;
	/** 二进制 / 流 / 字符串请求体，需显式指定 contentType */
	binary?: { data: Buffer | Readable | string; contentType: string };
	/**
	 * @deprecated 已被 `formData` / `binary` 替代，未来版本会移除。
	 * 留作向后兼容：调用方需通过 `extraHeaders` 自行注入 Content-Type。
	 */
	rawData?: unknown;
}

/** 凭证里强制存在的字符串字段 */
const REQUIRED_CREDENTIAL_FIELDS = ['apiKey', 'entCode', 'privateKey'] as const;
type RequiredCredentialField = (typeof REQUIRED_CREDENTIAL_FIELDS)[number];

const CREDENTIAL_FIELD_LABELS: Record<RequiredCredentialField, string> = {
	apiKey: 'API Key',
	entCode: '企业租户 ID (entCode)',
	privateKey: 'RSA 私钥 (privateKey)',
};

/** 框架自动注入的查询参数键，禁止 `extraQuery` 覆盖以保证签名一致性 */
const RESERVED_QUERY_KEYS: ReadonlySet<string> = new Set([
	'entCode',
	'apiCode',
	'userName',
	'nonce',
	'timestamp',
	'sign',
]);

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = (baseUrl ?? '').trim();
	if (!trimmed) throw new Error('凭证缺少 baseUrl');
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildBasicAuth(apiKey: string): string {
	return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString('base64')}`;
}

/**
 * 解析 Moka 标准响应：
 * - 二进制（Buffer / ArrayBuffer / Uint8Array）原样返回；
 * - 含 number 类型 `code` 字段视为业务响应，code 不在 `successCodes` 内则抛 `MokaApiError`；
 * - 否则原样返回（兼容个别非标准响应）。
 *
 * 独立导出便于单元测试。
 */
export function parseMokaResponse<T = unknown>(
	res: unknown,
	options: {
		successCodes?: ReadonlyArray<number>;
		returnFullResponse?: boolean;
	} = {},
): T {
	if (res instanceof Buffer || res instanceof ArrayBuffer || res instanceof Uint8Array) {
		return res as unknown as T;
	}

	if (
		res &&
		typeof res === 'object' &&
		typeof (res as IMokaResponse).code === 'number'
	) {
		const obj = res as IMokaResponse<T>;
		const successCodes = options.successCodes ?? MokaSuccessCodes;
		if (!successCodes.includes(obj.code)) {
			throw new MokaApiError(obj.code, obj.msg ?? '', obj as IMokaResponse<unknown>);
		}
		return (options.returnFullResponse ? obj : (obj.data as T)) as T;
	}

	return res as T;
}

type PayloadKind = 'json' | 'form' | 'binary' | 'raw';

interface IResolvedPayload {
	kind: PayloadKind;
	body: unknown;
	headers: Record<string, string>;
	json: boolean;
}

function resolvePayload(options: IMokaRequestOptions): IResolvedPayload {
	if (options.binary) {
		return {
			kind: 'binary',
			body: options.binary.data,
			headers: { 'Content-Type': options.binary.contentType },
			json: false,
		};
	}
	if (options.formData) {
		return {
			kind: 'form',
			body: options.formData,
			// form-data 的 getHeaders 会自带 boundary，直接展开即可
			headers: options.formData.getHeaders() as Record<string, string>,
			json: false,
		};
	}
	if (options.rawData !== undefined) {
		// 兼容旧 API：调用方通过 extraHeaders 自行注入 Content-Type
		return { kind: 'raw', body: options.rawData, headers: {}, json: false };
	}
	return {
		kind: 'json',
		body: options.body,
		headers: { 'Content-Type': 'application/json' },
		json: true,
	};
}

/**
 * Moka People API 请求函数：
 * - 复用 n8n 内置 `ctx.helpers.httpRequest`（代理 / 超时 / 日志）；
 * - 不走 `httpRequestWithAuthentication`，所有 Authorization / Query / sign 由本函数构造；
 * - 自动 RSA-MD5 生成 `sign` 并拼接到查询参数；
 * - 自动校验业务 `code`，非成功抛出带原始响应体的 `NodeApiError`（并携带 `itemIndex`）。
 *
 * @example
 * ```ts
 * const data = await mokaRequest<EmployeeAddResp>(this, {
 *   method: 'POST',
 *   path: '/v2/core/rosters/addEmployees',
 *   body: { data: [...] },
 *   apiCode,
 *   itemIndex: index,
 *   timeout,
 * });
 * ```
 */
export async function mokaRequest<T = IDataObject>(
	ctx: IExecuteFunctions,
	options: IMokaRequestOptions,
): Promise<T> {
	const itemIndex = options.itemIndex;
	const node = ctx.getNode();

	const credentials = await ctx.getCredentials(Credentials.MokaPeopleApi);
	const baseUrl = normalizeBaseUrl((credentials.baseUrl as string) ?? '');

	const credFields: Record<RequiredCredentialField, string> = {
		apiKey: ((credentials.apiKey as string) ?? '').trim(),
		entCode: ((credentials.entCode as string) ?? '').trim(),
		privateKey: ((credentials.privateKey as string) ?? '').trim(),
	};

	for (const field of REQUIRED_CREDENTIAL_FIELDS) {
		if (!credFields[field]) {
			throw new NodeOperationError(
				node,
				`缺少 ${field}：请在凭证中配置「${CREDENTIAL_FIELD_LABELS[field]}」`,
				{ itemIndex },
			);
		}
	}

	const apiCode = (options.apiCode ?? '').trim();
	const userName = (options.userName ?? '').trim();
	if (!apiCode) {
		throw new NodeOperationError(
			node,
			'缺少 apiCode：请在节点参数中填写「接口编码 (apiCode)」',
			{ itemIndex },
		);
	}

	// 1. 收集签名参数（extraQuery 不允许覆盖框架字段）
	const filteredExtraQuery: Record<string, string | number> = {};
	if (options.extraQuery) {
		for (const [k, v] of Object.entries(options.extraQuery)) {
			if (v === undefined || v === null) continue;
			if (RESERVED_QUERY_KEYS.has(k)) {
				throw new NodeOperationError(
					node,
					`extraQuery 字段「${k}」由 mokaRequest 自动注入，不能在调用方传入`,
					{ itemIndex },
				);
			}
			filteredExtraQuery[k] = typeof v === 'boolean' ? String(v) : v;
		}
	}

	const merged: Record<string, string | number> = {
		entCode: credFields.entCode,
		apiCode,
		...(userName ? { userName } : {}),
		...filteredExtraQuery,
		nonce: generateNonce(),
		timestamp: Date.now(),
	};

	// 2. 计算签名 —— RSA-MD5
	const sign = rsaSign(buildStringToSign(merged), credFields.privateKey);

	const qs: IDataObject = {};
	for (const [k, v] of Object.entries(merged)) qs[k] = String(v);
	qs.sign = sign;

	// 3. 解析请求体（按优先级选取一种 payload）
	const payload = resolvePayload(options);

	const headers: IDataObject = {
		Authorization: buildBasicAuth(credFields.apiKey),
		...payload.headers,
		...(options.extraHeaders ?? {}),
	};

	const requestOptions: IHttpRequestOptions = {
		method: options.method ?? 'POST',
		url: `${baseUrl}${options.path}`,
		qs,
		headers,
		body: payload.body as IHttpRequestOptions['body'],
		// JSON 场景交给 n8n 自动序列化；binary / form / raw 保持原样
		json: payload.json,
	};

	if (options.timeout && options.timeout > 0) {
		requestOptions.timeout = options.timeout;
	}

	// 出于安全考虑：仅打印非敏感的关键字段，绝不 log apiKey / sign / privateKey / body
	ctx.logger?.debug?.(
		`[mokaRequest] ${requestOptions.method} ${options.path} payload=${payload.kind}`,
		{
			apiCode,
			hasUserName: !!userName,
			extraQueryKeys: Object.keys(filteredExtraQuery),
			timeout: requestOptions.timeout,
		},
	);

	try {
		// 该工具不使用凭证模板的 authenticate 注入，Authorization / sign 完全由本函数构造，
		// 因此显式调用 httpRequest 而非 httpRequestWithAuthentication。
		const responseBody = await ctx.helpers.httpRequest(requestOptions);

		return parseMokaResponse<T>(responseBody, {
			successCodes: options.successCodes,
			returnFullResponse: options.returnFullResponse,
		});
	} catch (error) {
		// 已经是 n8n 标准错误就原样抛出，保留底层 HTTP 信息
		if (error instanceof NodeApiError || error instanceof NodeOperationError) {
			throw error; // eslint-disable-line @n8n/community-nodes/require-node-api-error
		}

		// 业务错误：保留完整原始响应到 NodeApiError，方便 UI Details 查看
		if (error instanceof MokaApiError) {
			throw new NodeApiError(node, error.raw as unknown as JsonObject, {
				message: `Moka API 业务错误：${error.code} ${error.msg || ''}`.trim(),
				description: `apiCode=${apiCode}, path=${options.path}`,
				itemIndex,
			});
		}

		// 网络 / HTTP 错误：尽量从 axios 风格错误结构里挖出 response.body
		const errObj = error as {
			response?: { body?: unknown; statusCode?: number };
			message?: string;
		};
		const errorResponse = (errObj.response?.body ?? error ?? {}) as JsonObject;
		throw new NodeApiError(node, errorResponse, {
			message: errObj.message ?? String(error),
			description: `path=${options.path}`,
			itemIndex,
		});
	}
}

/**
 * @deprecated 推荐使用具名导出 `mokaRequest(ctx, options)`。
 * 本默认导出仅为方便老代码继续 `import MokaRequest from '...'`。
 */
export default mokaRequest;
