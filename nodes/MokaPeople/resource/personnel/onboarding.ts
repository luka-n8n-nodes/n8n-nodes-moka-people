import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import MokaRequest from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	readBatchConfig,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 待入职员工数据接口
 * 接口路径：POST /v1/roster/onboarding
 * 文档：https://people.mokahr.com/docs/api/view/v1.html#-97
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 * 该接口不需要 userName。
 *
 * 接口原始响应：
 * {
 *   code: 200,
 *   msg: '操作成功',
 *   data: { pageSize, pageNum, total, size, list: [...] }
 * }
 *
 * 该 operation 只透出 data.list 数组（每条待入职员工一条 n8n item）。
 */

const PATH = '/v1/roster/onboarding';

/** returnAll = true 时自动分页使用的固定 pageSize（接口最大值 50） */
const AUTO_PAGE_SIZE = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IOnboardingData {
	pageSize: number;
	pageNum: number;
	total: number;
	size: number;
	list: IDataObject[];
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
				// fall through to comma split
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
		displayName: '个人电话列表 (telephoneList)',
		name: 'telephoneList',
		type: 'string',
		default: '',
		placeholder: '13800000000,13900000000',
		description: 'Array&lt;String&gt;，个人电话列表，长度不超过 50。支持 JSON 数组或逗号分隔',
	},
	{
		displayName: '公司邮箱列表 (officeEmailList)',
		name: 'officeEmailList',
		type: 'string',
		default: '',
		placeholder: 'a@x.com,b@x.com',
		description: 'Array&lt;String&gt;，公司邮箱列表，长度不超过 50',
	},
	{
		displayName: '个人邮箱列表 (personalEmailList)',
		name: 'personalEmailList',
		type: 'string',
		default: '',
		placeholder: 'a@gmail.com,b@gmail.com',
		description: 'Array&lt;String&gt;，个人邮箱列表，长度不超过 50',
	},
	{
		displayName: '待入职 ID 列表 (obIds)',
		name: 'obIds',
		type: 'string',
		default: '',
		placeholder: '1001,1002,1003 或 [1001,1002]',
		description:
			'Array&lt;Long&gt;，待入职 ID 数组，长度不超过 50。使用该参数时可不传入职时间或者更新时间',
	},
	{
		displayName: '更新时间-开始 (updateStartTime)',
		name: 'updateStartTime',
		type: 'string',
		default: '',
		placeholder: '2024-01-01 00:00:00',
		description: '更新时间查询开始时间，格式：yyyy-MM-dd HH:mm:ss，时间不超过 180 天',
	},
	{
		displayName: '更新时间-结束 (updateEndTime)',
		name: 'updateEndTime',
		type: 'string',
		default: '',
		placeholder: '2024-12-31 23:59:59',
		description: '更新时间查询结束时间，格式：yyyy-MM-dd HH:mm:ss，时间不超过 180 天',
	},
	{
		displayName: '入职时间-开始 (onBoardingStartTime)',
		name: 'onBoardingStartTime',
		type: 'string',
		default: '',
		placeholder: '2024-01-01 00:00:00',
		description:
			'入职时间查询开始时间，格式：yyyy-MM-dd HH:mm:ss，时间不超过 180 天。' +
			'<br><strong>注意：不使用 obIds 参数时，入职时间、更新时间需要二选一或者都填</strong>',
	},
	{
		displayName: '入职时间-结束 (onBoardingEndTime)',
		name: 'onBoardingEndTime',
		type: 'string',
		default: '',
		placeholder: '2024-12-31 23:59:59',
		description: '入职时间查询结束时间，格式：yyyy-MM-dd HH:mm:ss，时间不超过 180 天',
	},
];

const operation: ResourceOperations = {
	name: '待入职员工数据',
	value: 'onboarding',
	description: '查询待入职员工数据 (POST /v1/roster/onboarding)',
	action: '查询待入职员工数据',
	order: 15,
	options: [
		{
			displayName:
				'待入职员工数据接口。不使用 obIds 参数时，入职时间、更新时间需要二选一或者都填。' +
				'详细文档请参考：' +
				'<a href="https://people.mokahr.com/docs/api/view/v1.html#-97" target="_blank">' +
				'https://people.mokahr.com/docs/api/view/v1.html#-97</a>',
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
				'在 Moka People 后台「设置」→「对外接口设置」中为「待入职员工数据」接口配置的接口编码',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(50),
		...filterFields,
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [
				timeoutOption(),
				batchingOption({ showWhen: { '/returnAll': [true] } }),
			],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const telephoneList = parseListField(this.getNodeParameter('telephoneList', index, ''));
		const officeEmailList = parseListField(this.getNodeParameter('officeEmailList', index, ''));
		const personalEmailList = parseListField(
			this.getNodeParameter('personalEmailList', index, ''),
		);
		const obIds = parseListField(this.getNodeParameter('obIds', index, ''), true);
		const updateStartTime = (
			this.getNodeParameter('updateStartTime', index, '') as string
		).trim();
		const updateEndTime = (this.getNodeParameter('updateEndTime', index, '') as string).trim();
		const onBoardingStartTime = (
			this.getNodeParameter('onBoardingStartTime', index, '') as string
		).trim();
		const onBoardingEndTime = (
			this.getNodeParameter('onBoardingEndTime', index, '') as string
		).trim();

		const filterBody: IDataObject = {};
		if (telephoneList && telephoneList.length > 0) filterBody.telephoneList = telephoneList;
		if (officeEmailList && officeEmailList.length > 0) filterBody.officeEmailList = officeEmailList;
		if (personalEmailList && personalEmailList.length > 0)
			filterBody.personalEmailList = personalEmailList;
		if (obIds && obIds.length > 0) filterBody.obIds = obIds;
		if (updateStartTime) filterBody.updateStartTime = updateStartTime;
		if (updateEndTime) filterBody.updateEndTime = updateEndTime;
		if (onBoardingStartTime) filterBody.onBoardingStartTime = onBoardingStartTime;
		if (onBoardingEndTime) filterBody.onBoardingEndTime = onBoardingEndTime;

		const buildBody = (pageSize: number, pageNum: number): IDataObject => ({
			...filterBody,
			pageSize,
			pageNum,
		});

		const requestPage = async (pageSize: number, pageNum: number): Promise<IOnboardingData> => {
			const data = await MokaRequest.call.call(this, {
				method: 'POST',
				path: PATH,
				body: buildBody(pageSize, pageNum),
				apiCode,
				timeout,
			});
			return data as unknown as IOnboardingData;
		};

		if (returnAll) {
			const batchConfig = readBatchConfig.call(this, index);

			const firstPage = await requestPage(AUTO_PAGE_SIZE, 1);
			const firstList = Array.isArray(firstPage.list) ? firstPage.list : [];
			const allRecords: IDataObject[] = [...firstList];
			const total = firstPage.total ?? 0;

			const totalPages =
				total > 0
					? Math.ceil(total / AUTO_PAGE_SIZE)
					: firstList.length === AUTO_PAGE_SIZE
					? -1
					: 1;

			if (totalPages > 1) {
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

		const limit = this.getNodeParameter('limit', index, 50) as number;
		const data = await requestPage(limit, 1);
		return Array.isArray(data.list) ? data.list : [];
	},
};

export default operation;
