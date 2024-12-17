import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';
import {LOLAPP_TOKEN, LOLAPP_COMPANY_KEY} from "../config";

export class FunctionController {
    private openApiDoc: APIEndpoint[];
    constructor(openApiFilePath: string) {
        console.log('FunctionController')
        const fileContent = fs.readFileSync(openApiFilePath, 'utf8');
        this.openApiDoc = JSON.parse(fileContent);
    }

   get tools(){
        return this.openApiDoc.map((t) => {
            return {
                name: t.name,
                description: t.description,
                type: t.type,
                parameters: t.parameters,
            }
        })
   }

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

            const tool = this.openApiDoc.find((t) => t.name === name)
            if(!tool)
                throw new Error(`Function not found: ${name}`)

            const pre_url = `${base_url}${tool.url}`;
            const url = this.replacePlaceholders(pre_url, params);

            const response = await axios({
                method: tool.method,
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Company-Key': LOLAPP_COMPANY_KEY,
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
