import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import MokaRequest from '../../../help/utils/MokaRequest';
import { parseJsonArray, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 更新员工接口
 * 接口路径：POST /v2/core/rosters/updateEmployees
 * 文档：https://people.mokahr.com/docs/api/view/v1.html#-97
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 * 签名 Query 不含 userName（与新增员工接口一致）。
 *
 * 请求体（Body）字段较多且嵌套复杂，
 * 因此本节点直接暴露一个 JSON 字段供调用方完整透传。
 *
 * 响应：直接透出 Moka 业务体 data 节点。
 */

const PATH = '/v2/core/rosters/updateEmployees';

const DEFAULT_DATA_TEMPLATE = JSON.stringify(
	[
		{
			employee_no: 'GH202404231942',
			realname: '更新后的姓名',
		},
	],
	null,
	2,
);

const properties: INodeProperties[] = [
	{
		displayName:
			'更新员工接口，详细字段含义与示例请参考：' +
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
			'在 Moka People 后台「设置」→「对外接口设置」中为「更新员工接口」配置的接口编码',
	},
	{
		displayName: '员工数据 (Data)',
		name: 'data',
		type: 'json',
		typeOptions: {
			rows: 12,
		},
		default: DEFAULT_DATA_TEMPLATE,
		required: true,
		description:
			'只需填写数组 JSON（<code>[{...}, {...}]</code>），每个对象代表一名待更新员工，代码会自动包装为 <code>{ "data": [...] }</code> 发送。' +
			'员工字段（如 realname、employee_no、begin_work_time、id_no、contract 等）请参考' +
			'<a href="https://people.mokahr.com/docs/api/view/v1.html#-97" target="_blank">官方文档</a>',
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
	name: '更新员工',
	value: 'updateEmployees',
	description: '更新员工 (POST /v2/core/rosters/updateEmployees)',
	action: '更新员工',
	order: 30,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const rawData = this.getNodeParameter('data', index, '') as unknown;
		const dataArray = parseJsonArray(rawData);

		const data = await MokaRequest.call.call(this, {
			method: 'POST',
			path: PATH,
			body: { data: dataArray } as IDataObject,
			apiCode,
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
