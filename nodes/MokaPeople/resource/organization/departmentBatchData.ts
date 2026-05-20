import { IDataObject, INodeProperties, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	readBatchConfig,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 组织部门数据接口
 * 接口路径：POST /v1/org/department/batchData
 * 文档：Moka People API → HCM → 组织部门数据
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign），
 * 该接口不需要 userName。
 *
 * 接口原始响应：
 * {
 *   code: 200,
 *   msg: '操作成功',
 *   data: { list: [...], total, size, labelList: [...] }
 * }
 *
 * 该 operation 只透出 data.list 数组（每个部门一条 n8n item），
 * 其余 labelList / 分页信息不再返回。
 */

const PATH = '/v1/org/department/batchData';

/** returnAll = true 时自动分页使用的固定 pageSize（接口最大值） */
const AUTO_PAGE_SIZE = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 组织部门数据响应中 data 节点的结构
 */
interface IDepartmentBatchData {
	list: IDataObject[];
	total: number;
	size: number;
	labelList?: unknown;
}

/**
 * 解析数组类字符串字段：支持 Array<Long> / Array<String>。
 * - 已是数组直接返回
 * - 字符串支持 JSON 数组写法（'["a","b"]'）或英文/中文逗号分隔
 * - 空字符串/未填则忽略（不加入 body）
 */
function parseListField(raw: unknown, asNumber = false): unknown[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (Array.isArray(raw)) {
		return asNumber ? raw.map((x) => Number(x)).filter((x) => !Number.isNaN(x)) : raw;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) return undefined;
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed)) {
					return asNumber
						? parsed.map((x) => Number(x)).filter((x) => !Number.isNaN(x))
						: parsed.map((x) => String(x));
				}
			} catch {
				// 解析失败，回退到逗号分隔
			}
		}
		const parts = trimmed
			.split(/[，,\s\n]+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		return asNumber ? parts.map((x) => Number(x)).filter((x) => !Number.isNaN(x)) : parts;
	}
	return undefined;
}

const filterFields: INodeProperties[] = [
	{
		displayName: '部门 ID 列表 (nodeUidList)',
		name: 'nodeUidList',
		type: 'string',
		default: '',
		placeholder: '103658,103659 或 [103658,103659]',
		description:
			'Array&lt;Long&gt;，部门 ID 列表，长度不超过 200。' +
			'<br><strong>注意：部门 ID 数组与部门编码数组不可以同时传入，二者择一传入即可。</strong>',
	},
	{
		displayName: '部门编码列表 (nodeCodeList)',
		name: 'nodeCodeList',
		type: 'string',
		default: '',
		placeholder: 'NO.114545,NO.114546 或 ["NO.114545","NO.114546"]',
		description:
			'Array&lt;String&gt;，部门编码列表，长度不超过 200。' +
			'<br><strong>注意：部门 ID 数组与部门编码数组不可以同时传入，二者择一传入即可。</strong>',
	},
	{
		displayName: '是否启用 (haveUsed)',
		name: 'haveUsed',
		type: 'options',
		default: '',
		description: '部门启用状态过滤；不指定时不传入 body',
		options: [
			{ name: '不指定 (返回全部)', value: '' },
			{ name: '启用 (1)', value: 1 },
			{ name: '停用 (0)', value: 0 },
		],
	},
];

const operation: ResourceOperations = {
	name: '组织部门数据',
	value: 'departmentBatchData',
	description: '查询组织部门数据 (POST /v1/org/department/batchData)',
	action: '查询组织部门数据',
	order: 10,
	options: [
		{
			displayName:
				'组织部门数据接口。部门 ID 数组（nodeUidList）与部门编码数组（nodeCodeList）不可以同时传入，二者择一传入即可。',
			name: 'noticeDoc',
			type: 'notice',
			default: '',
		},
		{
			displayName: '接口编码 (apiCode)',
			name: 'apiCode',
			type: 'string',
			default: '',
			required: true,
			description:
				'在 Moka People 后台「设置」→「对外接口设置」中为「批量-组织架构信息」接口配置的接口编码',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(200),
		...filterFields,
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [
				timeoutOption(),
				// Batching 仅在勾选 Return All 时出现在 Add Option 下拉里
				batchingOption({ showWhen: { '/returnAll': [true] } }),
			],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const nodeUidList = parseListField(
			this.getNodeParameter('nodeUidList', index, ''),
			true,
		);
		const nodeCodeList = parseListField(this.getNodeParameter('nodeCodeList', index, ''));
		const haveUsedRaw = this.getNodeParameter('haveUsed', index, '') as string | number;

		// 互斥校验：部门 ID 与部门编码不可同时传入
		if (
			nodeUidList &&
			nodeUidList.length > 0 &&
			nodeCodeList &&
			nodeCodeList.length > 0
		) {
			throw new NodeOperationError(
				this.getNode(),
				'部门 ID 数组 (nodeUidList) 与部门编码数组 (nodeCodeList) 不可以同时传入，二者择一传入即可',
				{ itemIndex: index },
			);
		}

		const filterBody: IDataObject = {};
		if (nodeUidList && nodeUidList.length > 0) filterBody.nodeUidList = nodeUidList;
		if (nodeCodeList && nodeCodeList.length > 0) filterBody.nodeCodeList = nodeCodeList;
		// haveUsed 为 0/1 数字，空字符串表示未指定（不传入）
		if (haveUsedRaw === 0 || haveUsedRaw === 1) {
			filterBody.haveUsed = haveUsedRaw;
		}

		const buildBody = (pageSize: number, pageNum: number): IDataObject => ({
			...filterBody,
			pageSize,
			pageNum,
		});

		const requestPage = async (
			pageSize: number,
			pageNum: number,
		): Promise<IDepartmentBatchData> => {
			const data = await mokaRequest(this, {
				method: 'POST',
				path: PATH,
				body: buildBody(pageSize, pageNum),
				apiCode,
				itemIndex: index,
				timeout,
			});
			return data as unknown as IDepartmentBatchData;
		};

		if (returnAll) {
			const batchConfig = readBatchConfig.call(this, index);

			// 1) 第 1 页串行获取，用 total 推算总页数
			const firstPage = await requestPage(AUTO_PAGE_SIZE, 1);
			const firstList = Array.isArray(firstPage.list) ? firstPage.list : [];
			const allRecords: IDataObject[] = [...firstList];
			const total = firstPage.total ?? 0;

			// total > 0：精确总页数；total = 0 且首页满页：未知，需要兜底串行翻页
			const totalPages =
				total > 0
					? Math.ceil(total / AUTO_PAGE_SIZE)
					: firstList.length === AUTO_PAGE_SIZE
					? -1
					: 1;

			if (totalPages > 1) {
				// 2) 已知总页数：批量并发抓取剩余页
				const remainingPages: number[] = [];
				for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

				for (let i = 0; i < remainingPages.length; i += batchConfig.batchSize) {
					if (i > 0 && batchConfig.batchInterval > 0) {
						await sleep(batchConfig.batchInterval);
					}
					const chunk = remainingPages.slice(i, i + batchConfig.batchSize);
					const responses = await Promise.all(
						chunk.map((p) => requestPage(AUTO_PAGE_SIZE, p)),
					);
					for (const resp of responses) {
						const list = Array.isArray(resp.list) ? resp.list : [];
						allRecords.push(...list);
					}
				}
			} else if (totalPages === -1) {
				// 3) total 未知且首页满页：按 batchInterval/batchSize 平均节流串行翻页
				const perRequestDelay = Math.max(
					1,
					Math.ceil(batchConfig.batchInterval / Math.max(1, batchConfig.batchSize)),
				);
				let pageNum = 2;
				while (true) {
					await sleep(perRequestDelay);
					const data = await requestPage(AUTO_PAGE_SIZE, pageNum);
					const list = Array.isArray(data.list) ? data.list : [];
					allRecords.push(...list);
					if (list.length < AUTO_PAGE_SIZE) break;
					pageNum += 1;
				}
			}

			return allRecords;
		}

		// 未勾选 Return All：用 limit 充当 pageSize，单页一次请求即可
		const limit = this.getNodeParameter('limit', index, 50) as number;
		const data = await requestPage(limit, 1);
		return Array.isArray(data.list) ? data.list : [];
	},
};

export default operation;
