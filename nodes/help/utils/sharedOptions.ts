import { IDataObject, IDisplayOptions, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

/**
 * 通用 Batching 配置：控制并发分页拉取的节奏。
 *
 * - enabled = 用户是否在 Options 里显式添加了 Batching 子项；
 * - batchSize / batchInterval = 实际生效值（未启用时为默认值）。
 */
export interface IBatchConfig {
	enabled: boolean;
	batchSize: number;
	batchInterval: number;
}

/** Batching 默认值：每批 3 个请求并发，间隔 1000ms（即 3 次/秒）。 */
export const DEFAULT_BATCH_SIZE = 3;
export const DEFAULT_BATCH_INTERVAL_MS = 1000;

/**
 * 通用分页参数（Moka People API 标准分页：pageNum / pageSize）。
 */
export const paginationOptions = {
	returnAll: {
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	} as INodeProperties,

	/**
	 * @param maxValue Moka People API 单页上限默认 200
	 */
	limit: (maxValue = 200): INodeProperties => ({
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
			maxValue,
		},
		displayOptions: {
			show: {
				returnAll: [false],
			},
		},
		description:
			'返回结果的最大条数，同时充当单页 pageSize。Return All 模式不使用此字段，自动分页固定 pageSize=200',
	}),
};

/**
 * 通用 Batching 节点参数（fixedCollection 形式）。
 *
 * 通常作为某个 Options(collection) 内部的一个子选项使用：
 *
 * ```ts
 * {
 *   displayName: 'Options',
 *   name: 'options',
 *   type: 'collection',
 *   options: [
 *     timeoutOption(),
 *     batchingOption({ showWhen: { '/returnAll': [true] } }),
 *   ],
 * }
 * ```
 *
 * 之后用 `readBatchConfig.call(this, index)` 在 call 函数里读取实际配置。
 */
export function batchingOption(opts?: {
	/** 自定义可见性，例如 `{ '/returnAll': [true] }` 让 Batching 仅在 returnAll 勾选时可选。键以 `/` 开头表示根级参数路径 */
	showWhen?: IDisplayOptions['show'];
	batchSize?: number;
	batchInterval?: number;
}): INodeProperties {
	const display: Pick<INodeProperties, 'displayOptions'> = opts?.showWhen
		? { displayOptions: { show: opts.showWhen } }
		: {};
	return {
		displayName: 'Batching',
		name: 'batching',
		type: 'fixedCollection',
		placeholder: 'Add Batching',
		default: {},
		description: '自动分页时的并发节奏，默认 3 次/秒（贴合常见接口限速）',
		...display,
		options: [
			{
				name: 'config',
				displayName: 'Batching',
				values: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						default: opts?.batchSize ?? DEFAULT_BATCH_SIZE,
						typeOptions: { minValue: 1 },
						description: '每批并发的请求数量',
					},
					{
						displayName: 'Batch Interval',
						name: 'batchInterval',
						type: 'number',
						default: opts?.batchInterval ?? DEFAULT_BATCH_INTERVAL_MS,
						typeOptions: { minValue: 0 },
						description: '相邻两批请求之间的等待时间，单位毫秒（ms）',
					},
				],
			},
		],
	};
}

/**
 * 从节点参数读取 Batching 配置：
 * - 用户未在 `<parentParam>.batching` 里展开 Batching 子项时，enabled = false，使用默认值；
 * - 展开并填写后，按用户值生效（缺省项仍走默认）。
 *
 * @param parentParam 包裹 Batching 的父参数名（默认 'options'，对应 Options collection 的 name）
 */
export function readBatchConfig(
	this: IExecuteFunctions,
	index: number,
	parentParam: string = 'options',
): IBatchConfig {
	const params = this.getNodeParameter(parentParam, index, {}) as {
		batching?: { config?: { batchSize?: number; batchInterval?: number } };
	};
	const config = params?.batching?.config;
	return {
		enabled: !!config,
		batchSize: Math.max(1, Number(config?.batchSize ?? DEFAULT_BATCH_SIZE)),
		batchInterval: Math.max(0, Number(config?.batchInterval ?? DEFAULT_BATCH_INTERVAL_MS)),
	};
}

/**
 * 解析 n8n type:'json' 字段为 IDataObject。
 * 兼容字符串（手输）和对象（表达式注入）两种形态，统一校验后返回。
 */
export function parseJsonBody(raw: unknown): IDataObject {
	if (raw === null || raw === undefined) {
		throw new Error('请求体 JSON (body) 不能为空');
	}
	if (typeof raw === 'object') {
		if (Array.isArray(raw)) {
			throw new Error('请求体 JSON 必须是对象（最外层为 {}），不能是数组');
		}
		return raw as IDataObject;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) {
			throw new Error('请求体 JSON (body) 不能为空');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`请求体 JSON 解析失败：${msg}`);
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('请求体 JSON 必须是对象（最外层为 {}），不能是数组或基础类型');
		}
		return parsed as IDataObject;
	}
	throw new Error(`请求体 JSON 类型无效：${typeof raw}`);
}

/**
 * 解析 n8n type:'json' 字段为 IDataObject 数组。
 * 用户只需填写数组内容 `[{...}, {...}]`，代码负责包装到指定外层字段。
 * 兼容字符串（手输）和数组/对象（表达式注入）两种形态。
 */
export function parseJsonArray(raw: unknown): IDataObject[] {
	if (raw === null || raw === undefined) {
		throw new Error('请求体 JSON 不能为空');
	}
	if (Array.isArray(raw)) {
		return raw as IDataObject[];
	}
	if (typeof raw === 'object') {
		return [raw as IDataObject];
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) {
			throw new Error('请求体 JSON 不能为空');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`请求体 JSON 解析失败：${msg}`);
		}
		if (Array.isArray(parsed)) {
			return parsed as IDataObject[];
		}
		if (parsed && typeof parsed === 'object') {
			return [parsed as IDataObject];
		}
		throw new Error('请求体 JSON 必须是数组 [...] 或对象 {...}');
	}
	throw new Error(`请求体 JSON 类型无效：${typeof raw}`);
}

/**
 * 通用 Timeout 节点参数（扁平 number 字段）。默认 0 = 不超时。
 *
 * 一般作为某个 Options(collection) 内的一个可选项使用，参数读取直接 `options.timeout`。
 */
export function timeoutOption(opts?: { defaultMs?: number }): INodeProperties {
	return {
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: opts?.defaultMs ?? 0,
		typeOptions: { minValue: 0 },
		description: '请求超时时间，单位毫秒（ms）。0 表示不超时',
	};
}
