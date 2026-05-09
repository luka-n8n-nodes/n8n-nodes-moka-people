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
 * 员工任职数据接口
 * 接口路径：POST /v4/batch/data
 * 文档：Moka People API → HCM → 员工任职数据
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / userName / nonce / timestamp / sign）。
 * Body 字段：见下方 properties 定义。
 *
 * 接口原始响应：
 * {
 *   code: 200,
 *   msg: '操作成功',
 *   data: { labelList, pageSize, pageNum, total, size, list: [...] }
 * }
 *
 * 该 operation 只透出 data.list 数组（每个员工一条 n8n item），
 * 其余 labelList / 分页信息不再返回。
 */

const PATH = '/v4/batch/data';

/** returnAll = true 时自动分页使用的固定 pageSize（接口最大值） */
const AUTO_PAGE_SIZE = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 员工任职数据响应中 data 节点的结构
 */
interface IEmployeeTenureData {
	labelList?: unknown;
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
		// JSON 数组格式
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

/**
 * Body 字段公共属性定义
 */
const filterFields: INodeProperties[] = [
	{
		displayName: '员工 ID 列表 (uuidList)',
		name: 'uuidList',
		type: 'string',
		default: '',
		placeholder: '1001,1002,1003 或 [1001,1002]',
		description: 'Array&lt;Long&gt;，员工 ID 列表，长度不超过 2000。支持 JSON 数组或逗号分隔',
	},
	{
		displayName: '员工工号列表 (employeeNoList)',
		name: 'employeeNoList',
		type: 'string',
		default: '',
		placeholder: 'E001,E002 或 ["E001","E002"]',
		description: 'Array&lt;String&gt;，员工工号列表，数组长度不超过 2000',
	},
	{
		displayName: '员工公司邮箱列表 (officeEmailList)',
		name: 'officeEmailList',
		type: 'string',
		default: '',
		placeholder: 'a@x.com,b@x.com',
		description: 'Array&lt;String&gt;，员工公司邮箱列表，数组长度不超过 2000',
	},
	{
		displayName: '员工手机号列表 (telephoneList)',
		name: 'telephoneList',
		type: 'string',
		default: '',
		placeholder: '13800000000,13900000000',
		description: 'Array&lt;String&gt;，员工手机号列表，数组长度不超过 2000',
	},
	{
		displayName: '员工证件号列表 (idNoList)',
		name: 'idNoList',
		type: 'string',
		default: '',
		description: 'Array&lt;String&gt;，员工证件号码列表，数组长度不超过 2000',
	},
	{
		displayName: '更新起始时间 (startDate)',
		name: 'startDate',
		type: 'string',
		default: '',
		placeholder: '2024-01-01 00:00:00',
		description: '员工信息更新时间范围起点，格式：yyyy-MM-dd HH:mm:ss',
	},
	{
		displayName: '更新结束时间 (endDate)',
		name: 'endDate',
		type: 'string',
		default: '',
		placeholder: '2024-12-31 23:59:59',
		description: '员工信息更新时间范围终点，格式：yyyy-MM-dd HH:mm:ss',
	},
];

const operation: ResourceOperations = {
	name: '员工任职数据',
	value: 'employeeTenure',
	description: '查询员工任职数据 (POST /v4/batch/data)',
	action: '查询员工任职数据',
	order: 10,
	options: [
		{
			displayName: '注意：员工数据不包含「待入职」的数据。',
			name: 'noticeNoPreOnboarding',
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
				'在 Moka People 后台「设置」→「对外接口设置」中为「员工任职数据」接口配置的接口编码',
		},
		{
			displayName: '调用账号 (userName)',
			name: 'userName',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'someone@yourcompany.com',
			description:
				'您所属租户下的某个员工的邮箱，注意：<br>' +
				'1. 该员工必须拥有此 apiCode 应用中授权的角色。<br>' +
				'2. 该员工账号权限中此角色的管理范围，决定了返回数据的范围，管理员可以在 People 的「设置」-「账号权限」-「账号管理」中配置返回的数据范围。<br>' +
				'3. 推荐使用 超级管理员 权限。<br>' +
				'4. 员工离职时账号权限会被收回。',
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
		const userName = (this.getNodeParameter('userName', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const uuidList = parseListField(
			this.getNodeParameter('uuidList', index, ''),
			true,
		);
		const employeeNoList = parseListField(this.getNodeParameter('employeeNoList', index, ''));
		const officeEmailList = parseListField(this.getNodeParameter('officeEmailList', index, ''));
		const telephoneList = parseListField(this.getNodeParameter('telephoneList', index, ''));
		const idNoList = parseListField(this.getNodeParameter('idNoList', index, ''));
		const startDate = (this.getNodeParameter('startDate', index, '') as string).trim();
		const endDate = (this.getNodeParameter('endDate', index, '') as string).trim();

		// 构建过滤条件公共部分
		const filterBody: IDataObject = {};
		if (uuidList && uuidList.length > 0) filterBody.uuidList = uuidList;
		if (employeeNoList && employeeNoList.length > 0) filterBody.employeeNoList = employeeNoList;
		if (officeEmailList && officeEmailList.length > 0) filterBody.officeEmailList = officeEmailList;
		if (telephoneList && telephoneList.length > 0) filterBody.telephoneList = telephoneList;
		if (idNoList && idNoList.length > 0) filterBody.idNoList = idNoList;
		if (startDate) filterBody.startDate = startDate;
		if (endDate) filterBody.endDate = endDate;

		const buildBody = (pageSize: number, pageNum: number): IDataObject => ({
			...filterBody,
			pageSize,
			pageNum,
		});

		// 单页请求
		const requestPage = async (pageSize: number, pageNum: number): Promise<IEmployeeTenureData> => {
			const data = await MokaRequest.call.call(this, {
				method: 'POST',
				path: PATH,
				body: buildBody(pageSize, pageNum),
				apiCode,
				userName,
				timeout,
			});
			return data as unknown as IEmployeeTenureData;
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
