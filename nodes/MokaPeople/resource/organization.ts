import { ResourceOptions } from '../../help/type/IResource';

/**
 * 组织接口资源定义
 *
 * 对应 Moka People API → HCM 组织架构相关接口（部门、岗位等）。
 */
const resource: ResourceOptions = {
	name: '组织接口',
	value: 'organization',
	description: 'Moka People 组织架构相关接口',
	order: 20,
};

export default resource;
