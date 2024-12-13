import fs from 'fs';
import yaml from 'js-yaml';
import fetch from 'node-fetch';

export class FunctionController {
    constructor(openApiFilePath) {

        const fileContent = fs.readFileSync(openApiFilePath, 'utf8');

        if (openApiFilePath.endsWith('.yaml') || openApiFilePath.endsWith('.yml')) {
            this.openApiDoc = yaml.load(fileContent);
        } else {
            this.openApiDoc = JSON.parse(fileContent);
        }
    }

    get tools() {
        try {
            // Vérifiez que `paths` existe et est un objet
            if (!this.openApiDoc.paths || typeof this.openApiDoc.paths !== 'object') {
                console.error("Invalid or missing 'paths' in OpenAPI document.");
                return [];
            }

            return Object.entries(this.openApiDoc.paths).reduce((tools, [path, operations]) => {
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
                            properties: operation.parameters.reduce((acc, param) => {
                                acc[param.name] = {
                                    type: param.schema?.type || "string",
                                    description: param.description || ""
                                };
                                return acc;
                            }, {}),
                            required: operation.parameters
                                .filter(p => p.required)
                                .map(p => p.name),
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
}
