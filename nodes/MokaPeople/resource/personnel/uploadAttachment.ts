import { IDataObject, INodeProperties } from 'n8n-workflow';
import FormData from 'form-data';
import { ResourceOperations } from '../../../help/type/IResource';
import MokaRequest from '../../../help/utils/MokaRequest';
import { timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 通用附件上传接口
 * 接口路径：POST /v1/attachment/uploadAttachment
 * 文档：https://people.mokahr.com/docs/api/view/v1.html#-97
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 *
 * 请求体为 multipart/form-data，字段：
 *   upload_file（必填）：上传的文件，大小不超过 20MB
 *
 * 本节点从上游 n8n 节点的 Binary Data 中读取文件，组装为 FormData 后发送。
 */

const PATH = '/v1/attachment/uploadAttachment';

const properties: INodeProperties[] = [
	{
		displayName:
			'通用附件上传接口（multipart/form-data），文件大小不超过 20MB。详细文档请参考：' +
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
			'在 Moka People 后台「设置」→「对外接口设置」中为「通用附件上传」接口配置的接口编码',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description:
			'上游节点输出中包含文件的 Binary Property 名称。' +
			'例如「Read Binary File」节点默认输出到 <code>data</code>',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [timeoutOption({ defaultMs: 60000 })],
	},
];

const operation: ResourceOperations = {
	name: '通用附件上传',
	value: 'uploadAttachment',
	description: '上传附件 (POST /v1/attachment/uploadAttachment)',
	action: '通用附件上传',
	order: 40,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const binaryPropertyName = (
			this.getNodeParameter('binaryPropertyName', index, 'data') as string
		).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const binaryData = this.helpers.assertBinaryData(index, binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(index, binaryPropertyName);

		const fileName = binaryData.fileName ?? 'upload_file';
		const mimeType = binaryData.mimeType ?? 'application/octet-stream';

		const form = new FormData();
		form.append('upload_file', buffer, {
			filename: fileName,
			contentType: mimeType,
		});

		const data = await MokaRequest.call.call(this, {
			method: 'POST',
			path: PATH,
			rawData: form,
			extraHeaders: form.getHeaders(),
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
