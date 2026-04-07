import api from './api';

const PRESIGN_THRESHOLD_BYTES = 10 * 1024 * 1024;

export type UploadedAttachment = {
    id: string;
    filename: string;
    contentType?: string | null;
    sizeBytes?: number | null;
    scanStatus?: string | null;
};

export type AttachmentUploadFailure = {
    file: File;
    message: string;
};

const getErrorMessage = (error: any, fallback: string) => {
    const apiMessage = error?.response?.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
        if (apiMessage.toLowerCase().includes('no file uploaded')) {
            return 'No file data reached the server. If this is a malware test file (like EICAR), local browser or OS security may have blocked the upload.';
        }
        return apiMessage.trim();
    }
    const networkCode = String(error?.code || '').toUpperCase();
    const networkMessage = String(error?.message || '').trim();
    if (!error?.response && (networkCode === 'ERR_NETWORK' || networkMessage.toLowerCase() === 'network error')) {
        return 'Upload failed before reaching the server. If this is a malware test file (like EICAR), local browser or OS security may block the upload.';
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return fallback;
};

const shouldFallbackToDirectUpload = (error: any) => {
    const status = Number(error?.response?.status || 0);
    const message = String(error?.response?.data?.message || error?.message || '').toLowerCase();
    return status === 400 && message.includes('s3-compatible storage');
};

export const formatAttachmentSize = (bytes?: number | null) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const uploadAttachmentDirect = async (
    messageId: string,
    file: File,
): Promise<UploadedAttachment> => {
    const formData = new FormData();
    formData.append('messageId', messageId);
    formData.append('file', file);

    const response = await api.post('/attachments/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });

    return response.data as UploadedAttachment;
};

const uploadAttachmentWithPresign = async (
    messageId: string,
    file: File,
): Promise<UploadedAttachment> => {
    const contentType = file.type || 'application/octet-stream';
    const presignResponse = await api.post('/attachments/presign', {
        messageId,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
    });

    const uploadUrl = String(presignResponse.data?.url || '');
    const storageKey = String(presignResponse.data?.storageKey || '');
    const uploadToken = String(presignResponse.data?.uploadToken || '');

    if (!uploadUrl || !storageKey || !uploadToken) {
        throw new Error('Attachment upload preparation failed.');
    }

    const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': contentType,
        },
        body: file,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Attachment storage upload failed (${uploadResponse.status}).`);
    }

    const confirmResponse = await api.post('/attachments/confirm', {
        messageId,
        storageKey,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
        uploadToken,
    });

    return confirmResponse.data as UploadedAttachment;
};

export const uploadAttachmentForMessage = async (
    messageId: string,
    file: File,
): Promise<UploadedAttachment> => {
    if (file.size > PRESIGN_THRESHOLD_BYTES) {
        try {
            return await uploadAttachmentWithPresign(messageId, file);
        } catch (error) {
            if (!shouldFallbackToDirectUpload(error)) {
                throw error;
            }
        }
    }

    return uploadAttachmentDirect(messageId, file);
};

export const uploadAttachmentsForMessage = async (
    messageId: string,
    files: File[],
): Promise<{ uploaded: UploadedAttachment[]; failed: AttachmentUploadFailure[] }> => {
    const uploaded: UploadedAttachment[] = [];
    const failed: AttachmentUploadFailure[] = [];

    for (const file of files) {
        try {
            uploaded.push(await uploadAttachmentForMessage(messageId, file));
        } catch (error) {
            failed.push({
                file,
                message: getErrorMessage(error, `Failed to upload ${file.name}.`),
            });
        }
    }

    return { uploaded, failed };
};

export const summarizeAttachmentUploadFailure = (
    failures: AttachmentUploadFailure[],
) => {
    if (!Array.isArray(failures) || failures.length === 0) {
        return '';
    }

    const [firstFailure] = failures;
    if (failures.length === 1) {
        return `${firstFailure.file.name}: ${firstFailure.message}`;
    }

    return `${failures.length} attachments failed to upload. First failure: ${firstFailure.file.name}: ${firstFailure.message}`;
};
