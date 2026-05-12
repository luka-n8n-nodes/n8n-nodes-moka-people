import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	JsonObject,
	NodeApiError,
} from 'n8n-workflow';
import axios, { AxiosError } from 'axios';
import { Credentials, MokaSuccessCode } from '../type/enums';
import { buildStringToSign, generateNonce, rsaSign } from './sign';

/**
 * Moka API 调用入参。
 */
export interface IMokaRequestOptions {
	method?: IHttpRequestMethods;
	/** 业务接口路径，例如 '/v1/batch/data' */
	path: string;
	/** 业务请求体（JSON）。与 rawData 互斥，rawData 优先 */
	body?: IDataObject;
	/**
	 * 原始请求体（非 JSON），例如 FormData 实例。
	 * 设置后 body 被忽略，且不会强制 Content-Type: application/json，
	 * 由 axios 根据 data 类型自动推断（FormData → multipart/form-data）。
	 */
	rawData?: unknown;
	/** 额外的请求头，会与默认 Authorization 合并（rawData 场景下常用） */
	extraHeaders?: Record<string, string>;
	/** 额外的查询参数（会一并参与签名） */
	extraQuery?: Record<string, string | number>;
	/** 接口编码（必填），由各节点自行从用户输入收集后传入 */
	apiCode: string;
	/** 调用账号 userName（邮箱），仅当此值非空时才会参与签名并加入 Query */
	userName?: string;
	/** 请求超时时间（毫秒）。0 / undefined 表示不超时（沿用 axios 默认行为） */
	timeout?: number;
}

/**
 * Moka People API 标准响应。
 */
export interface IMokaResponse<T = unknown> {
	code: number;
	msg?: string;
	data: T;
}

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = (baseUrl ?? '').trim();
	if (!trimmed) throw new Error('凭证缺少 baseUrl');
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildBasicAuth(apiKey: string): string {
	return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString('base64')}`;
}

/**
 * Moka People API 请求工具：
 * - 直接使用 axios 发起请求，不走 n8n 的 httpRequestWithAuthentication / 凭证 authenticate 注入
 * - 所有 Header（含 Authorization）、Query、Body 全部由代码控制，行为与 requestDemo.js 完全一致
 * - 自动用 RSA-MD5 生成 sign 并拼接到查询参数
 * - 自动校验 code === 200，非 200 抛出 `Request Moka API Error: {code}, {msg}`
 */
class MokaRequest {
	private static processResponse<T>(res: IMokaResponse<T>): T {
		if (res && typeof res === 'object' && res.code !== undefined && res.code !== MokaSuccessCode) {
			throw new Error(`Request Moka API Error: ${res.code}, ${res.msg ?? ''}`);
		}
		return (res?.data ?? res) as T;
	}

	static async call<T = IDataObject>(
		this: IExecuteFunctions,
		options: IMokaRequestOptions,
	): Promise<T> {
		const credentials = await this.getCredentials(Credentials.MokaPeopleApi);

		const baseUrl = normalizeBaseUrl(credentials.baseUrl as string);
		const apiKey = ((credentials.apiKey as string) ?? '').trim();
		const entCode = ((credentials.entCode as string) ?? '').trim();
		const privateKey = ((credentials.privateKey as string) ?? '').trim();

		const apiCode = (options.apiCode ?? '').trim();
		const userName = (options.userName ?? '').trim();

		if (!apiKey) throw new Error('缺少 apiKey：请在凭证中配置「API Key」');
		if (!entCode) throw new Error('缺少 entCode：请在凭证中配置「企业租户 ID (entCode)」');
		if (!privateKey) throw new Error('缺少 privateKey：请在凭证中配置「RSA 私钥 (privateKey)」');
		if (!apiCode) throw new Error('缺少 apiCode：请在节点参数中填写「接口编码 (apiCode)」');

		// 1. 收集签名参数（仅在有 userName 时纳入签名）
		const merged: Record<string, string | number> = {
			entCode,
			apiCode,
			...(userName ? { userName } : {}),
			...(options.extraQuery ?? {}),
			nonce: generateNonce(),
			timestamp: Date.now(),
		};

		// 2. 计算签名 —— RSA-MD5
		const sign = rsaSign(buildStringToSign(merged), privateKey);

		const qs: Record<string, string> = {};
		for (const [k, v] of Object.entries(merged)) qs[k] = String(v);
		qs.sign = sign;

		const useRawData = options.rawData !== undefined;
		const requestData = useRawData ? options.rawData : options.body;
		const headers: Record<string, string> = {
			Authorization: buildBasicAuth(apiKey),
			...(useRawData ? {} : { 'Content-Type': 'application/json' }),
			...(options.extraHeaders ?? {}),
		};

		try {
			const response = await axios.request<IMokaResponse<T>>({
				method: options.method ?? 'POST',
				url: `${baseUrl}${options.path}`,
				params: qs,
				data: requestData,
				headers,
				// timeout=0 表示不超时（axios 默认行为），与 timeout 字段语义保持一致
				timeout: options.timeout && options.timeout > 0 ? options.timeout : 0,
				// 自己处理状态码：不让 axios 因为 4xx/5xx 抛错，方便统一在下面解析 Moka 业务体
				validateStatus: () => true,
			});

			if (response.status === 200) {
				return MokaRequest.processResponse<T>(response.data);
			}

			// 非 200：尽量从响应体里提取 Moka 业务 code/msg
			const data = response.data as unknown as Record<string, unknown> | undefined;
			const code = data?.code ?? response.status;
			const msg = data?.msg ?? response.statusText ?? 'Request failed';
			throw new NodeApiError(this.getNode(), (data ?? {}) as JsonObject, {
				message: `Request Moka API Error: ${code}, ${msg}`,
			});
		} catch (error) {
			if (error instanceof NodeApiError) throw error; // eslint-disable-line @n8n/community-nodes/require-node-api-error

			// axios 自身错误（DNS / 连接拒绝 / 超时 / SSL 等）
			const axiosErr = error as AxiosError<Record<string, unknown>>;
			if (axiosErr?.isAxiosError) {
				const data = axiosErr.response?.data;
				const code = data?.code ?? axiosErr.response?.status ?? axiosErr.code ?? 'NETWORK_ERROR';
				const msg = data?.msg ?? axiosErr.message;
				throw new NodeApiError(this.getNode(), (data ?? {}) as JsonObject, {
					message: `Request Moka API Error: ${code}, ${msg}`,
				});
			}

			// 业务错误（processResponse 抛出的）
			if (error instanceof Error) {
				throw new NodeApiError(this.getNode(), {} as JsonObject, {
					message: error.message,
				});
			}
			throw new NodeApiError(this.getNode(), {} as JsonObject, {
				message: String(error),
			});
		}
	}
}

export default MokaRequest;
