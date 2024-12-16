interface APIEndpoint {
    name: string;
    method: string;
    url: string;
    type: string;
    description: string;
    parameters?: {
        type: string;
        properties: Record<string, Parameter>;
        required?: string[];
    };
    properties?: Record<string, Parameter>;
    required?: string[];
}
interface Parameter {
    type: string;
    description?: string;
    properties?: Record<string, Parameter>;
    required?: string[];
}