export declare const getOBject: () => {
    [key: string]: string;
}, getNumbers: () => Array<number>, callMeLater: (successCB: () => void, failureCB: () => void) => void, promiseNumber: (value: number) => Promise<number>, reverseString: (str: string) => string, decodeOpus: (encodedData: string) => string, createOpusDecoder: (sampleRate: number, channels: number) => Promise<{
    success: boolean;
    decoderId?: number;
    error?: string;
}>, decodeOpusPacket: (packetBase64: string, decoderId: number) => Promise<{
    success: boolean;
    decodedDataBase64?: string;
    samplesDecoded?: number;
    error?: string;
}>, destroyOpusDecoder: (decoderId: number) => Promise<{
    success: boolean;
    error?: string;
}>, decodeOpusFile: (filepath: string, decoderId: number, chunkSize: number) => Promise<{
    success: boolean;
    decodedDataBase64?: string;
    samplesDecoded?: number;
    processingTimeMs?: number;
    error?: string;
}>, decodeOpusData: (dataBase64: string, decoderId: number, chunkSize: number) => Promise<{
    success: boolean;
    decodedDataBase64?: string;
    samplesDecoded?: number;
    processingTimeMs?: number;
    error?: string;
}>, saveDecodedDataAsWav: (decodedDataBase64: string, filepath: string, sampleRate: number, channels: number) => Promise<{
    success: boolean;
    filepath?: string;
    error?: string;
}>;
//# sourceMappingURL=index.d.ts.map