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
    "/api/v2/harmony/cancel/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Harmony */
        post: operations["cancelHarmonyGeneration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v2/harmony/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate Harmony */
        post: operations["startHarmonyGeneration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v2/jobs/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Harmony Job */
        get: operations["getHarmonyJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v2/models/{model_id}/manifest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Harmony Manifest */
        get: operations["getHarmonyModelManifest"];
        put?: never;
        post?: never;
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
        /** ErrorResponseV2 */
        ErrorResponseV2: {
            /**
             * Apiversion
             * @description Expose the harmony-preview contract version.
             * @constant
             */
            readonly apiVersion: "2";
            error: components["schemas"]["ErrorInfo"];
            /** Requestid */
            requestId: string;
            /**
             * Success
             * @constant
             */
            readonly success: false;
        };
        /** HarmonyCancelRequest */
        HarmonyCancelRequest: {
            /**
             * Apiversion
             * @constant
             */
            apiVersion: "2";
            /** Requestid */
            requestId: string;
        };
        /** HarmonyCandidate */
        HarmonyCandidate: {
            /**
             * Adoptable
             * @default false
             * @constant
             */
            adoptable: false;
            /** Candidateid */
            candidateId: string;
            /** Events */
            events: components["schemas"]["HarmonyFactorEvent"][];
            /**
             * Hardrulevalidation
             * @default pendingClient
             * @constant
             */
            hardRuleValidation: "pendingClient";
            /** Hardrulevector */
            hardRuleVector?: {
                [key: string]: number;
            };
            /** Neuralmeanlogprobability */
            neuralMeanLogProbability: number | null;
            /**
             * Requiresclientvalidation
             * @default true
             * @constant
             */
            requiresClientValidation: true;
        };
        /** HarmonyCondition */
        HarmonyCondition: {
            /**
             * Bassoffsetfromroot
             * @default 0
             */
            bassOffsetFromRoot: number;
            /** Durationtick */
            durationTick: number;
            /** Extensions */
            extensions?: ("6" | "9" | "b9" | "#9" | "11" | "#11" | "13" | "b13")[];
            /**
             * Inversion
             * @default 0
             */
            inversion: number;
            /**
             * Locked
             * @default false
             */
            locked: boolean;
            /**
             * Quality
             * @enum {string}
             */
            quality: "major" | "minor" | "diminished" | "augmented" | "dominant7" | "major7" | "minor7" | "halfDiminished7" | "diminished7" | "minorMajor7" | "augmentedMajor7" | "sus2" | "sus4" | "add9" | "minorAdd9";
            /** Rootoffsetfromkey */
            rootOffsetFromKey: number;
            /** Starttick */
            startTick: number;
        };
        /** HarmonyControls */
        HarmonyControls: {
            /** Endtick */
            endTick: number;
            /**
             * Ppq
             * @default 480
             */
            ppq: number;
            /** Starttick */
            startTick: number;
            /** Ticksperbar */
            ticksPerBar: number;
            /**
             * Timesignature
             * @enum {string}
             */
            timeSignature: "4/4" | "3/4" | "6/8";
        };
        /** HarmonyEditSpan */
        HarmonyEditSpan: {
            /** Endtick */
            endTick: number;
            /**
             * Mode
             * @enum {string}
             */
            mode: "generate" | "preserve" | "conditionOnly";
            /** Starttick */
            startTick: number;
        };
        /** HarmonyFactorEvent */
        HarmonyFactorEvent: {
            /** Bassoffsetfromroot */
            bassOffsetFromRoot: number;
            /** Confidence */
            confidence: number;
            /** Durationtick */
            durationTick: number;
            /** Extensions */
            extensions: ("6" | "9" | "b9" | "#9" | "11" | "#11" | "13" | "b13")[];
            /** Inversion */
            inversion: number;
            /**
             * Maskmode
             * @enum {string}
             */
            maskMode: "generated" | "preserved" | "conditionOnly";
            /**
             * Quality
             * @enum {string}
             */
            quality: "major" | "minor" | "diminished" | "augmented" | "dominant7" | "major7" | "minor7" | "halfDiminished7" | "diminished7" | "minorMajor7" | "augmentedMajor7" | "sus2" | "sus4" | "add9" | "minorAdd9";
            /** Rootoffsetfromkey */
            rootOffsetFromKey: number;
            /** Starttick */
            startTick: number;
        };
        /** HarmonyGenerateRequest */
        HarmonyGenerateRequest: {
            /**
             * Allowcpufallback
             * @default true
             */
            allowCpuFallback: boolean;
            /**
             * Apiversion
             * @constant
             */
            apiVersion: "2";
            /**
             * Candidatecount
             * @default 32
             */
            candidateCount: number;
            controls: components["schemas"]["HarmonyControls"];
            /** Existingharmony */
            existingHarmony?: components["schemas"]["HarmonyCondition"][];
            /** Generationmask */
            generationMask: components["schemas"]["HarmonyEditSpan"][];
            /** Melody */
            melody: components["schemas"]["HarmonyMelodyNote"][];
            /**
             * Modelid
             * @default harmonyforge-bimask-base-v1
             * @enum {string}
             */
            modelId: "harmonyforge-bimask-base-v1" | "mock-harmonyforge-bimask-v1";
            /**
             * Preferreddevice
             * @default auto
             * @enum {string}
             */
            preferredDevice: "auto" | "cpu" | "cuda" | "mps";
            /** Requestid */
            requestId: string;
            /** Seed */
            seed: string;
            /** Tonalities */
            tonalities: components["schemas"]["HarmonyTonalitySpan"][];
        };
        /** HarmonyJobError */
        HarmonyJobError: {
            /**
             * Code
             * @enum {string}
             */
            code: "MODEL_UNAVAILABLE" | "CHECKPOINT_INVALID" | "INFERENCE_FAILED" | "CANCELLED";
            /**
             * Compositionsafe
             * @default true
             * @constant
             */
            compositionSafe: true;
            /**
             * Fallbackavailable
             * @default true
             * @constant
             */
            fallbackAvailable: true;
            /** Message */
            message: string;
        };
        /** HarmonyJobResponse */
        HarmonyJobResponse: {
            /**
             * Apiversion
             * @description Expose the harmony-preview contract version.
             * @constant
             */
            readonly apiVersion: "2";
            /**
             * Backend
             * @enum {string}
             */
            backend: "pytorch" | "mock";
            /**
             * Batchsize
             * @default 1
             */
            batchSize: number;
            /** Candidatecount */
            candidateCount: number;
            /** Candidates */
            candidates?: components["schemas"]["HarmonyCandidate"][];
            /** Checkpointsha256 */
            checkpointSha256?: string | null;
            /**
             * Cpufallbackused
             * @default false
             */
            cpuFallbackUsed: boolean;
            /**
             * Deterministic
             * @default true
             */
            deterministic: boolean;
            /** Device */
            device: ("cpu" | "cuda" | "mps" | "coreml" | "directml") | null;
            /** Dtype */
            dtype: ("float32" | "float16" | "bfloat16") | null;
            /** Elapsedms */
            elapsedMs: number;
            error?: components["schemas"]["HarmonyJobError"] | null;
            /** Fallbackreason */
            fallbackReason?: string | null;
            /** Mock */
            mock: boolean;
            /**
             * Modelid
             * @enum {string}
             */
            modelId: "harmonyforge-bimask-base-v1" | "mock-harmonyforge-bimask-v1";
            /**
             * Partialcandidatestored
             * @default false
             * @constant
             */
            partialCandidateStored: false;
            /** Progress */
            progress: number;
            /** Requestid */
            requestId: string;
            /** Sourcecommit */
            sourceCommit?: string | null;
            /**
             * Stage
             * @enum {string}
             */
            stage: "Queued" | "Loading checkpoint" | "Encoding" | "Neural proposal" | "Decoding" | "Schema validation" | "Client theory validation" | "Complete" | "Cancel requested" | "Cancelled" | "Failed";
            /** Stagetimingsms */
            stageTimingsMs?: {
                [key: string]: number;
            };
            /**
             * State
             * @enum {string}
             */
            state: "queued" | "running" | "cancelRequested" | "completed" | "cancelled" | "failed";
            /** Tokenizersha256 */
            tokenizerSha256: string;
            /** Trained */
            trained: boolean;
        };
        /** HarmonyMelodyNote */
        HarmonyMelodyNote: {
            /** Durationtick */
            durationTick: number;
            /** Midi */
            midi: number;
            /**
             * Role
             * @default unknown
             * @enum {string}
             */
            role: "chordTone" | "scaleTone" | "passing" | "neighbor" | "approach" | "unknown";
            /** Starttick */
            startTick: number;
            /**
             * Velocity
             * @default 96
             */
            velocity: number;
        };
        /** HarmonyModelManifestResponse */
        HarmonyModelManifestResponse: {
            /**
             * Apiversion
             * @description Expose the harmony-preview contract version.
             * @constant
             */
            readonly apiVersion: "2";
            /** Architecture */
            architecture: {
                [key: string]: number | string | boolean;
            };
            /** Available */
            available: boolean;
            /** Checkpointsha256 */
            checkpointSha256: string | null;
            /**
             * Evaluationstatus
             * @enum {string}
             */
            evaluationStatus: "notEvaluated" | "researchOnly" | "validated";
            /** Mock */
            mock: boolean;
            /**
             * Modelid
             * @enum {string}
             */
            modelId: "harmonyforge-bimask-base-v1" | "mock-harmonyforge-bimask-v1";
            /** Requestid */
            requestId: string;
            /** Supporteddevices */
            supportedDevices: ("cpu" | "cuda" | "mps")[];
            /** Task */
            task: ("melody_conditioned_variable_rhythm_harmonization" | "harmony_only_pretraining") | null;
            /** Tokenizersha256 */
            tokenizerSha256: string;
            /** Trained */
            trained: boolean;
            /** Unavailablereason */
            unavailableReason?: string | null;
        };
        /** HarmonyTonalitySpan */
        HarmonyTonalitySpan: {
            /** Endtick */
            endTick: number;
            /** Keyroot */
            keyRoot: number;
            /**
             * Mode
             * @enum {string}
             */
            mode: "major" | "naturalMinor" | "harmonicMinor" | "dorian" | "mixolydian";
            /** Starttick */
            startTick: number;
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
            capabilities: ("rank" | "generateHarmony")[];
            /** Id */
            id: string;
            /** Loaded */
            loaded: boolean;
            /** Mock */
            mock: boolean;
            /** Name */
            name: string;
            /** Runtime */
            runtime: ("browser" | "cpu" | "cuda" | "mps" | "coreml" | "directml") | null;
            /** Task */
            task?: ("melody_conditioned_variable_rhythm_harmonization" | "harmony_only_pretraining") | null;
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
    cancelHarmonyGeneration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HarmonyCancelRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HarmonyJobResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Resource not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description The request conflicts with the current server state. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
        };
    };
    startHarmonyGeneration: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HarmonyGenerateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HarmonyJobResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description The request conflicts with the current server state. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description The requested service is unavailable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
        };
    };
    getHarmonyJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
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
                    "application/json": components["schemas"]["HarmonyJobResponse"];
                };
            };
            /** @description Authentication is required. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Authentication token is invalid. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Resource not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
        };
    };
    getHarmonyModelManifest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                model_id: "harmonyforge-bimask-base-v1" | "mock-harmonyforge-bimask-v1";
            };
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
                    "application/json": components["schemas"]["HarmonyModelManifestResponse"];
                };
            };
            /** @description Resource not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description Request validation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
            /** @description An internal server error occurred. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponseV2"];
                };
            };
        };
    };
}
