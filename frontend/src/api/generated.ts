// Generated from backend/openapi.json. Do not edit by hand.
export interface paths {
    "/api/device": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Device */
        get: operations["getDevice"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Models */
        get: operations["listModels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/load": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Load Model */
        post: operations["loadModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models/unload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unload Model */
        post: operations["unloadModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/preferences/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update Preferences */
        post: operations["updatePreferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rank": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rank */
        post: operations["rankCandidates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * DeviceResponse
         * @description Device capabilities with the shared API response envelope fields.
         */
        DeviceResponse: {
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /**
             * Coremlavailable
             * @default false
             */
            coremlAvailable: boolean;
            /** Cudaavailable */
            cudaAvailable: boolean;
            /** Cudadevicecount */
            cudaDeviceCount: number;
            /** Devicename */
            deviceName: string;
            /**
             * Directmlavailable
             * @default false
             */
            directmlAvailable: boolean;
            /** Mpsavailable */
            mpsAvailable: boolean;
            /**
             * Onnxcudaavailable
             * @default false
             */
            onnxCudaAvailable: boolean;
            /**
             * Onnxruntimeavailable
             * @default false
             */
            onnxRuntimeAvailable: boolean;
            /** Requestid */
            requestId: string;
            /**
             * Selecteddevice
             * @enum {string}
             */
            selectedDevice: "cpu" | "cuda" | "mps" | "coreml" | "directml";
            /** Torchavailable */
            torchAvailable: boolean;
            /**
             * Torchcudaavailable
             * @default false
             */
            torchCudaAvailable: boolean;
            /** Totalmemorymb */
            totalMemoryMb: number | null;
        };
        /** ErrorInfo */
        ErrorInfo: {
            /**
             * Code
             * @enum {string}
             */
            code: "AUTHENTICATION_REQUIRED" | "INVALID_AUTHENTICATION_TOKEN" | "VALIDATION_ERROR" | "CONFLICT" | "SERVICE_UNAVAILABLE" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "HTTP_ERROR" | "INTERNAL_ERROR";
            /** Message */
            message: string;
        };
        /** ErrorResponse */
        ErrorResponse: {
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            error: components["schemas"]["ErrorInfo"];
            /** Requestid */
            requestId: string;
            /**
             * Success
             * @constant
             */
            readonly success: false;
        };
        /** HealthResponse */
        HealthResponse: {
            /**
             * Activemodel
             * @enum {string}
             */
            activeModel: "local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1";
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /** Authrequired */
            authRequired: boolean;
            /**
             * Backend
             * @enum {string}
             */
            backend: "linear" | "corpus" | "pytorch" | "onnx" | "browser" | "mock";
            /** Fallbackreason */
            fallbackReason: string | null;
            /** Inferenceauthorized */
            inferenceAuthorized: boolean;
            /** Mock */
            mock: boolean;
            /** Platformmachine */
            platformMachine: string;
            /** Platformsystem */
            platformSystem: string;
            /** Pythonversion */
            pythonVersion: string;
            /** Requestid */
            requestId: string;
            /**
             * Runtime
             * @enum {string}
             */
            runtime: "cpu" | "cuda" | "mps" | "coreml" | "directml";
            /** Service */
            service: string;
            /**
             * Status
             * @constant
             */
            status: "ok";
            /** Version */
            version: string;
        };
        /** ModelActionRequest */
        ModelActionRequest: {
            /** Apiversion */
            apiVersion?: "1" | null;
            /**
             * Modelid
             * @enum {string}
             */
            modelId: "local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1";
            /** Requestid */
            requestId?: string | null;
        };
        /** ModelActionResponse */
        ModelActionResponse: {
            /**
             * Activebackend
             * @enum {string}
             */
            activeBackend: "linear" | "corpus" | "pytorch" | "onnx" | "browser" | "mock";
            /**
             * Activemodel
             * @enum {string}
             */
            activeModel: "local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1";
            /**
             * Activeruntime
             * @enum {string}
             */
            activeRuntime: "cpu" | "cuda" | "mps" | "coreml" | "directml";
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /** Cachesize */
            cacheSize: number;
            /** Fallbackreason */
            fallbackReason: string | null;
            /** Mock */
            mock: boolean;
            model: components["schemas"]["ModelInfo"];
            /** Requestid */
            requestId: string;
        };
        /** ModelInfo */
        ModelInfo: {
            /** Available */
            available: boolean;
            /**
             * Backend
             * @enum {string}
             */
            backend: "linear" | "corpus" | "pytorch" | "onnx" | "browser" | "mock";
            /** Capabilities */
            capabilities: "rank"[];
            /** Id */
            id: string;
            /** Loaded */
            loaded: boolean;
            /** Mock */
            mock: boolean;
            /** Name */
            name: string;
            /**
             * Runtime
             * @enum {string}
             */
            runtime: "browser" | "cpu" | "cuda" | "mps" | "coreml" | "directml";
        };
        /** ModelsResponse */
        ModelsResponse: {
            /**
             * Activebackend
             * @enum {string}
             */
            activeBackend: "linear" | "corpus" | "pytorch" | "onnx" | "browser" | "mock";
            /**
             * Activemodel
             * @enum {string}
             */
            activeModel: "local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1";
            /**
             * Activeruntime
             * @enum {string}
             */
            activeRuntime: "cpu" | "cuda" | "mps" | "coreml" | "directml";
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /** Fallbackreason */
            fallbackReason: string | null;
            /** Mock */
            mock: boolean;
            /** Models */
            models: components["schemas"]["ModelInfo"][];
            /** Requestid */
            requestId: string;
        };
        /** PreferenceUpdateRequest */
        PreferenceUpdateRequest: {
            /** Apiversion */
            apiVersion?: "1" | null;
            /**
             * Category
             * @enum {string}
             */
            category: "chords" | "melody" | "rhythm" | "voicing" | "combined";
            /** Features */
            features: {
                [key: string]: number;
            };
            /**
             * Feedback
             * @enum {string}
             */
            feedback: "like" | "dislike" | "favorite" | "abSelected" | "notMyStyle" | "adopted" | "immediateUndo" | "saved" | "midiExported" | "replayed" | "manuallyEdited";
            /** Requestid */
            requestId?: string | null;
            /**
             * Weight
             * @default 1
             */
            weight: number;
        };
        /** PreferenceUpdateResponse */
        PreferenceUpdateResponse: {
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /** Confidence */
            confidence: number;
            /** Evaluationcount */
            evaluationCount: number;
            /** Requestid */
            requestId: string;
            /** Weights */
            weights: {
                [key: string]: number;
            };
        };
        /** RankCandidate */
        RankCandidate: {
            /** Features */
            features?: {
                [key: string]: number;
            };
            /** Id */
            id: string;
        };
        /** RankRequest */
        RankRequest: {
            /**
             * Allowcpufallback
             * @default true
             */
            allowCpuFallback: boolean;
            /** Apiversion */
            apiVersion?: "1" | null;
            /**
             * Batchsize
             * @default 64
             */
            batchSize: number;
            /** Candidates */
            candidates: components["schemas"]["RankCandidate"][];
            /** Modelid */
            modelId?: ("local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1") | null;
            /**
             * Preferencecategory
             * @default combined
             * @enum {string}
             */
            preferenceCategory: "chords" | "melody" | "rhythm" | "voicing" | "combined";
            /**
             * Preferenceweights
             * @description Complete client preference profile when supplied; when omitted, the process-local profile for preferenceCategory is used.
             */
            preferenceWeights?: {
                [key: string]: number;
            };
            /** Requestid */
            requestId?: string | null;
        };
        /** RankResponse */
        RankResponse: {
            /**
             * Apiversion
             * @description Expose the immutable contract version as a required response field.
             * @constant
             */
            readonly apiVersion: "1";
            /**
             * Backend
             * @enum {string}
             */
            backend: "linear" | "corpus" | "pytorch" | "onnx" | "browser" | "mock";
            /** Batchsize */
            batchSize: number;
            /**
             * Device
             * @enum {string}
             */
            device: "cpu" | "cuda" | "mps" | "coreml" | "directml";
            /** Fallbackreason */
            fallbackReason?: string | null;
            /** Mock */
            mock: boolean;
            /**
             * Modelid
             * @enum {string}
             */
            modelId: "local-deterministic-v1" | "harmony-corpus-ngram-v1" | "local-mlp-v1" | "local-onnx-v1" | "mock-deterministic-v1";
            /** Ranked */
            ranked: components["schemas"]["RankedCandidate"][];
            /** Requestid */
            requestId: string;
            /**
             * Runtime
             * @enum {string}
             */
            runtime: "cpu" | "cuda" | "mps" | "coreml" | "directml";
        };
        /** RankedCandidate */
        RankedCandidate: {
            /** Id */
            id: string;
            /** Score */
            score: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listModels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelsResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    loadModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelActionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelActionResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The requested service is unavailable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    unloadModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelActionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelActionResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request conflicts with the current server state. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferenceUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferenceUpdateResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request conflicts with the current server state. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rankCandidates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RankRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RankResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The requested service is unavailable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
