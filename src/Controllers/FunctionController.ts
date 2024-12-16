import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';
import {LOLAPP_TOKEN} from "../config";

export class FunctionController {
    private openApiDoc;
    public tools: APIEndpoint[];
    constructor(openApiFilePath: string) {
        try{
            console.log('FunctionController')

            const fileContent = fs.readFileSync(openApiFilePath, 'utf8');
            if (openApiFilePath.endsWith('.yaml') || openApiFilePath.endsWith('.yml')) {
                this.openApiDoc = yaml.load(fileContent);
            } else {
                this.openApiDoc = JSON.parse(fileContent);
            }

            this.tools = this.openApiDoc
        } catch (error) {
            console.error('Error loading OpenAPI file:', error);
        }
    }

    // get tools() {
    //     try {
    //         return Object.entries(this.openApiDoc.paths).reduce<Tool[]>((tools, [path, operations]) => {
    //             if (!operations || typeof operations !== 'object') {
    //                 console.warn(`Invalid operations for path: ${path}`);
    //                 return tools;
    //             }
    //
    //             Object.entries(operations).forEach(([method, operation]) => {
    //                 if (!operation.operationId) {
    //                     console.error(`Missing operationId for method ${method} at path ${path}`);
    //                     return;
    //                 }
    //
    //                 const parametersSchema = operation.parameters?.length > 0
    //                     ? {
    //                         type: "object",
    //                         properties: operation.parameters.reduce((acc: { [x: string]: { type: any; description: any; }; }, param: { name: string | number; schema: { type: any; }; description: any; }) => {
    //                             acc[param.name] = {
    //                                 type: param.schema?.type || "string",
    //                                 description: param.description || ""
    //                             };
    //                             return acc;
    //                         }, {}),
    //                         required: operation.parameters
    //                             .filter((p: { required: any; }) => p.required)
    //                             .map((p: { name: any; }) => p.name),
    //                         additionalProperties: false
    //                     }
    //                     : null;
    //
    //                 tools.push({
    //                     name: operation.operationId.replace(/\./g, ''),
    //                     type: 'function',
    //                     description: operation.description || "No description provided",
    //                     ...(parametersSchema ? { parameters: parametersSchema } : {})
    //                 });
    //             });
    //
    //             return tools;
    //         }, []);
    //     } catch (error) {
    //         console.error('Error loading OpenAPI tools:', error);
    //         return [];
    //     }
    // }

    replacePlaceholders(url: string, params: string[]) {
        return url.replace(/{(\w+)}/g, (match, key) => {
            if (params[key] === undefined) {
                throw new Error(`Missing parameter: ${key}`);
            }
            return params[key];
        });
    }
    async executeFunction(name: string, args: any) {
        try {
            const base_url = "https://api.lola-france.fr";
            const params = JSON.parse(args)

            const tool = this.tools.find((t) => t.name === name)
            if(!tool)
                throw new Error(`Function not found: ${name}`)

            const pre_url = `${base_url}${tool.url}`;
            const url = this.replacePlaceholders(pre_url, params);

            const response = await axios({
                method: tool.method,
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Company-Key': 58,
                    Authorization: LOLAPP_TOKEN,
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
