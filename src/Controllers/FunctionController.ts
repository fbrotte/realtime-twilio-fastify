import fs from 'fs';
import yaml from 'js-yaml';

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

        const fileContent = fs.readFileSync(openApiFilePath, 'utf8');

        if (openApiFilePath.endsWith('.yaml') || openApiFilePath.endsWith('.yml')) {
            this.openApiDoc = yaml.load(fileContent);
        } else {
            this.openApiDoc = JSON.parse(fileContent);
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
                        name: operation.operationId,
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

    async executeFunction(name: any, arg: any) {
        return { name, arg }
    }
}
