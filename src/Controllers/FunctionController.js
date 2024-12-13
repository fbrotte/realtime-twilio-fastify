import fs from 'fs';
import yaml from 'js-yaml';
import fetch from 'node-fetch'; // Pour faire des appels HTTP si nécessaire

export class FunctionController {
    constructor(openApiFilePath, baseUrl) {
        this.baseUrl = baseUrl; // Base URL de l'API, si nécessaire
        this.tools = this.loadOpenApiTools(openApiFilePath);
        // console.log(this.tools)
    }

    loadOpenApiTools(filePath) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            let openApiDoc;

            // Charger le fichier YAML ou JSON
            if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
                openApiDoc = yaml.load(fileContent);
            } else {
                openApiDoc = JSON.parse(fileContent);
            }

            // Extraire les outils depuis les chemins définis dans le fichier OpenAPI
            const tools = openApiDoc.paths
                ? Object.keys(openApiDoc.paths).map(path => {
                    const operations = openApiDoc.paths[path];
                    return Object.keys(operations).map(method => {
                        const operation = operations[method];

                        if (!operation.operationId) {
                            console.error(`Missing operationId for method ${method} at path ${path}`);
                            return null; // Ignorer les opérations sans operationId
                        }

                        const parametersSchema = operation.parameters && operation.parameters.length > 0
                            ? {
                                type: "object",
                                properties: operation.parameters.reduce((acc, param) => {
                                    acc[param.name] = {
                                        type: param.schema?.type || "string",
                                        description: param.description || ""
                                    };
                                    return acc;
                                }, {}),
                                required: operation.parameters.filter(p => p.required).map(p => p.name),
                                additionalProperties: false
                            }
                            : null;

                        return {
                            name: operation.operationId,
                            type: 'function',
                            description: operation.description || "No description provided",
                            ...(parametersSchema ? { parameters: parametersSchema } : {})
                        };
                    }).filter(tool => tool !== null);
                }).flat()
                : [];

            return tools;
        } catch (error) {
            console.error('Error loading OpenAPI file:', error);
            return [];
        }
    }


    async executeFunction(functionName, params) {
        const tool = this.tools.find(t => t.name === functionName);

        if (!tool) {
            throw new Error(`Function ${functionName} not found in OpenAPI tools`);
        }

        // Créer l'URL pour l'appel d'API (avec les paramètres encodés si nécessaire)
        const url = this.buildUrlWithParams(tool.url, params);

        // Appel HTTP dynamique basé sur la méthode (GET, POST, etc.)
        return await this.callApi(tool.method, url, params);
    }

    // Construire l'URL avec les paramètres de la fonction
    buildUrlWithParams(url, params) {
        const urlObj = new URL(url);
        Object.keys(params).forEach(key => urlObj.searchParams.append(key, params[key]));
        return urlObj.toString();
    }

    // Appel d'API (GET ou POST)
    async callApi(method, url, params) {
        let options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (method === 'POST') {
            options.body = JSON.stringify(params);
        }

        try {
            const response = await fetch(url, options);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error calling API ${url}:`, error);
            throw error;
        }
    }
}
