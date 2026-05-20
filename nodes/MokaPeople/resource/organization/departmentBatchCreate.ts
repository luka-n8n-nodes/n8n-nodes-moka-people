import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { parseJsonArray, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 新增组织部门接口
 * 接口路径：POST /v1/org/department/batchCreate
 * 文档：Moka People API → HCM → 新增组织部门接口
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign），
 * 该接口不需要 userName。
 *
 * 请求体（Body）字段较多且嵌套（含 superiorDept / deptDirector / deptHrbp / extendFields 等），
 * 因此本节点直接暴露一个 JSON 字段供调用方完整透传，避免在节点上枚举所有字段。
 *
 * 必填字段（按官方文档）：
 *   - nodeCode          部门编码
 *   - deptSampleName    部门名称
 *   - effectDate        生效日期
 *   - superiorDept.superiorDeptCode   上级部门编码
 *   - superiorDept.superiorDeptId     上级部门 ID
 *
 * 响应：data 为数组，每个元素对应单条写入结果（含 nodeUid / nodeCode / code / msg）。
 */

const PATH = '/v1/org/department/batchCreate';

const DEFAULT_DATA_TEMPLATE = JSON.stringify(
	[
		{
			nodeCode: 'NO.114545',
			deptSampleName: '部门名称',
			effectDate: '2024-04-06',
			superiorDept: {
				superiorDeptCode: '',
				superiorDeptId: 0,
			},
			deptType: '1',
			deptHierarchy: '2',
			deptDirector: {
				deptDirectorId: '',
				deptDirectorEmpNo: '',
			},
			deptHrbp: {
				deptHrbpId: '',
				deptHrbpEmpNo: '',
			},
			treeOrder: '',
			extendFields: [],
		},
	],
	null,
	2,
);

const properties: INodeProperties[] = [
	{
		displayName:
			'新增组织部门接口。必填字段：nodeCode（部门编码）、deptSampleName（部门名称）、effectDate（生效日期）、' +
			'superiorDept.superiorDeptCode（上级部门编码）、superiorDept.superiorDeptId（上级部门 ID）。' +
			'<br>详细字段含义与示例请参考：' +
			'<a href="https://people.mokahr.com/docs/api/view/v1.html" target="_blank">' +
			'https://people.mokahr.com/docs/api/view/v1.html</a>',
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
			'在 Moka People 后台「设置」→「对外接口设置」中为「新增组织部门接口」配置的接口编码',
	},
	{
		displayName: '部门数据 (Data)',
		name: 'data',
		type: 'json',
		typeOptions: {
			rows: 14,
		},
		default: DEFAULT_DATA_TEMPLATE,
		required: true,
		description:
			'只需填写数组 JSON（<code>[{...}, {...}]</code>），每个对象代表一条待新增的部门，代码会自动包装为 <code>{ "data": [...] }</code> 发送。<br>' +
			'必填字段：<code>nodeCode</code>、<code>deptSampleName</code>、<code>effectDate</code>、' +
			'<code>superiorDept.superiorDeptCode</code>、<code>superiorDept.superiorDeptId</code>。' +
			'其它字段（<code>deptType</code> / <code>deptHierarchy</code> / <code>deptDirector</code> / ' +
			'<code>deptHrbp</code> / <code>treeOrder</code> / <code>extendFields</code> 等）请参考' +
			'<a href="https://people.mokahr.com/docs/api/view/v1.html" target="_blank">官方文档</a>',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [timeoutOption()],
	},
];

const operation: ResourceOperations = {
	name: '新增组织部门',
	value: 'departmentBatchCreate',
	description: '新增组织部门 (POST /v1/org/department/batchCreate)',
	action: '新增组织部门',
	order: 20,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const rawData = this.getNodeParameter('data', index, '') as unknown;
		const dataArray = parseJsonArray(rawData);

		const data = await mokaRequest(this, {
			method: 'POST',
			path: PATH,
			body: { data: dataArray } as IDataObject,
			apiCode,
			itemIndex: index,
			timeout,
		});

		if (Array.isArray(data)) {
			return data as IDataObject[];
		}
		if (data && typeof data === 'object') {
			return data as IDataObject;
		}
		return { data } as IDataObject;
	},
};

export default operation;
