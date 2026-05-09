import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import ResourceFactory from '../help/builder/ResourceFactory';
import { Credentials } from '../help/type/enums';

const resourceBuilder = ResourceFactory.build(__dirname);

export class MokaPeople implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Moka People',
		name: 'mokaPeople',
		subtitle: '={{ $parameter.resource }}:{{ $parameter.operation }}',
		icon: 'file:icon.svg',
		group: ['transform'],
		version: [1],
		defaultVersion: 1,
		description: 'Moka People (HCM 人事系统) API 集成',
		defaults: {
			name: 'Moka People',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: Credentials.MokaPeopleApi,
				required: true,
			},
		],
		properties: [...resourceBuilder.build()],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const callFunc = resourceBuilder.getCall(resource, operation);

		if (!callFunc) {
			throw new NodeOperationError(this.getNode(), `未实现方法: ${resource}.${operation}`);
		}

		const returnData: INodeExecutionData[][] = [[]];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const responseData = await callFunc.call(this, itemIndex);

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject),
					{ itemData: { item: itemIndex } },
				);

				returnData[0].push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const errorData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({
							error: error instanceof Error ? error.message : String(error),
						}),
						{ itemData: { item: itemIndex } },
					);
					returnData[0].push(...errorData);
					continue;
				}
				throw error;
			}
		}

		return returnData;
	}
}
