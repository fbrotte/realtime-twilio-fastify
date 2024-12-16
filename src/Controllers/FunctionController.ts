import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';

type Tool = {
    name: string;
    type: string;
    description: string;
    parameters?: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
        additionalProperties: boolean;
    };
};

export class FunctionController {
    private openApiDoc;
    constructor(openApiFilePath: string) {
        try{
            console.log('FunctionController')

            const fileContent = fs.readFileSync(openApiFilePath, 'utf8');


            if (openApiFilePath.endsWith('.yaml') || openApiFilePath.endsWith('.yml')) {
                this.openApiDoc = yaml.load(fileContent);
            } else {
                this.openApiDoc = JSON.parse(fileContent);
            }

            // console.log(this.tools);
        } catch (error) {
            console.error('Error loading OpenAPI file:', error);
        }
    }

    get tools() {
        try {
            return Object.entries(this.openApiDoc.paths).reduce<Tool[]>((tools, [path, operations]) => {
                if (!operations || typeof operations !== 'object') {
                    console.warn(`Invalid operations for path: ${path}`);
                    return tools;
                }

                Object.entries(operations).forEach(([method, operation]) => {
                    if (!operation.operationId) {
                        console.error(`Missing operationId for method ${method} at path ${path}`);
                        return;
                    }

                    const parametersSchema = operation.parameters?.length > 0
                        ? {
                            type: "object",
                            properties: operation.parameters.reduce((acc: { [x: string]: { type: any; description: any; }; }, param: { name: string | number; schema: { type: any; }; description: any; }) => {
                                acc[param.name] = {
                                    type: param.schema?.type || "string",
                                    description: param.description || ""
                                };
                                return acc;
                            }, {}),
                            required: operation.parameters
                                .filter((p: { required: any; }) => p.required)
                                .map((p: { name: any; }) => p.name),
                            additionalProperties: false
                        }
                        : null;

                    tools.push({
                        name: operation.operationId.replace(/\./g, ''),
                        type: 'function',
                        description: operation.description || "No description provided",
                        ...(parametersSchema ? { parameters: parametersSchema } : {})
                    });
                });

                return tools;
            }, []);
        } catch (error) {
            console.error('Error loading OpenAPI tools:', error);
            return [];
        }
    }

    async executeFunction(name: string, args: any) {
        try {
            const operation = Object.entries(this.openApiDoc.paths).flatMap(([path, operations]) => {
                return Object.entries(operations as Record<string, any>).map(([method, op]) => ({ path, method, operation: op }));
            }).find((op) =>op.operation.operationId.replace(/\./g, '') === name);

            if (!operation) {
                throw new Error(`Function with name ${name} not found.`);
            }

            let { path, method, operation: op } = operation;

            const headers = {};
            const params = {};
            const data = {};

            console.log(op.parameters)

            op.parameters?.forEach((param: any) => {
                const value = JSON.parse(args)[param.name];
                if (value === undefined) {
                    if (param.required) {
                        throw new Error(`Missing required parameter: ${param.name}`);
                    }
                } else {
                    if (param.in === 'query') {
                        // @ts-ignore
                        params[param.name] = value;
                    } else if (param.in === 'header') {
                        // @ts-ignore
                        headers[param.name] = value;
                    } else if (param.in === 'path') {
                        path = path.replace(`{${param.name}}`, value);
                    } else if (param.in === 'body') {
                        Object.assign(data, value);
                    }
                }
            });
            const url = `${this.openApiDoc.servers?.[0]?.url || ''}${path}`

            console.log('Executing function:', url, method, args);

            const response = await axios({
                method,
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Company-Key': 3,
                    Authorization: `Bearer 17280|kz4PvPDAJCHdpBaAlBosXSd8XfanDGOdLjkwHrFc62a22694`,
                    ...headers
                },
                params,
                data: args
            });

            return response.data;
        } catch (error) {
            console.error('Error in fetch', error);
            return error
        }
    }
}
