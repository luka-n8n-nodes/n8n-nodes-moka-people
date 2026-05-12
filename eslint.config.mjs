import { config } from '@n8n/node-cli/eslint';

export default [
	...(Array.isArray(config) ? config : [config]),
	{
		rules: {
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-restricted-globals': 'off',
			'@n8n/community-nodes/credential-test-required': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'n8n-nodes-base/node-param-default-missing': 'off',
		},
	},
];
