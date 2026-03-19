import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Move, X } from 'lucide-react';

interface AvatarCropModalProps {
    file: File;
    onClose: () => void;
    onApply: (avatarDataUrl: string) => void;
}

const CANVAS_SIZE = 320;

export default function AvatarCropModal({ file, onClose, onApply }: AvatarCropModalProps) {
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

    useEffect(() => {
        setLoadError(null);
        setImageElement(null);

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                setLoadError('Could not read selected image.');
                return;
            }

            const img = new Image();
            img.onload = () => {
                setImageSrc(reader.result as string);
                setImageElement(img);
                setOffsetX(0);
                setOffsetY(0);
                setZoom(1);
            };
            img.onerror = () => {
                setLoadError('Could not load selected image.');
            };
            img.src = reader.result;
        };
        reader.onerror = () => {
            setLoadError('Could not read selected image.');
        };
        reader.readAsDataURL(file);

        return () => {
            reader.abort();
            setOffsetX(0);
            setOffsetY(0);
            setZoom(1);
        };
    }, [file]);

    const clampOffsets = (nextX: number, nextY: number, nextZoom = zoom) => {
        if (!imageElement) return { x: nextX, y: nextY };
        const scale = Math.max(CANVAS_SIZE / imageElement.width, CANVAS_SIZE / imageElement.height) * nextZoom;
        const drawnW = imageElement.width * scale;
        const drawnH = imageElement.height * scale;
        const maxX = Math.max(0, (drawnW - CANVAS_SIZE) / 2);
        const maxY = Math.max(0, (drawnH - CANVAS_SIZE) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, nextX)),
            y: Math.min(maxY, Math.max(-maxY, nextY))
        };
    };

    const handleZoomChange = (value: number) => {
        setZoom(value);
        const clamped = clampOffsets(offsetX, offsetY, value);
        setOffsetX(clamped.x);
        setOffsetY(clamped.y);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!imageElement) return;
        setDragging(true);
        dragStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            ox: offsetX,
            oy: offsetY
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging || !dragStartRef.current) return;
        const dx = event.clientX - dragStartRef.current.x;
        const dy = event.clientY - dragStartRef.current.y;
        const clamped = clampOffsets(dragStartRef.current.ox + dx, dragStartRef.current.oy + dy);
        setOffsetX(clamped.x);
        setOffsetY(clamped.y);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        setDragging(false);
        dragStartRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleApply = () => {
        if (!imageElement) return;

        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, 512, 512);

        const baseScale = Math.max(512 / imageElement.width, 512 / imageElement.height);
        const scale = baseScale * zoom;
        const drawW = imageElement.width * scale;
        const drawH = imageElement.height * scale;
        const centerX = (400 - drawW) / 2 + offsetX * (400 / CANVAS_SIZE);
        const centerY = (400 - drawH) / 2 + offsetY * (400 / CANVAS_SIZE);

        ctx.drawImage(imageElement, centerX, centerY, drawW, drawH);

        onApply(canvas.toDataURL('image/jpeg', 0.7));
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <button
                type="button"
                className="absolute inset-0 bg-[var(--color-text-primary)]/30"
                onClick={onClose}
                aria-label="Close image editor"
            />

            <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)] shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-card-border)]">
                    <h3 className="text-xl font-semibold">Edit Image</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)] transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    <div className="rounded-xl bg-[var(--color-background)] p-5 border border-[var(--color-card-border)]">
                        <div
                            className="relative mx-auto w-[320px] h-[320px] rounded-full overflow-hidden border-4 border-[var(--color-primary)]/20 bg-white cursor-grab active:cursor-grabbing touch-none shadow-inner"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        >
                            {imageElement && imageSrc ? (
                                <img
                                    src={imageSrc}
                                    alt="Avatar crop preview"
                                    draggable={false}
                                    className="absolute top-1/2 left-1/2 max-w-none select-none pointer-events-none"
                                    style={{
                                        width: `${Math.max(CANVAS_SIZE / imageElement.width, CANVAS_SIZE / imageElement.height) * zoom * imageElement.width}px`,
                                        height: `${Math.max(CANVAS_SIZE / imageElement.width, CANVAS_SIZE / imageElement.height) * zoom * imageElement.height}px`,
                                        transform: `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`
                                    }}
                                />
                            ) : (
                                <div className="h-full w-full flex flex-col items-center justify-center text-[var(--color-text-muted)] gap-2 px-6 text-center">
                                    <ImagePlus className="h-8 w-8" />
                                    <span className="text-xs">{loadError || 'Loading image preview...'}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl bg-[var(--color-background)] border border-[var(--color-card-border)] p-4">
                            <label className="block text-sm text-[var(--color-text-primary)] mb-2">Zoom</label>
                            <input
                                type="range"
                                min={1}
                                max={3}
                                step={0.01}
                                value={zoom}
                                onChange={(e) => handleZoomChange(Number(e.target.value))}
                                className="w-full accent-[var(--color-primary)]"
                            />
                        </div>
                        <div className="rounded-xl bg-[var(--color-background)] border border-[var(--color-card-border)] p-4">
                            <label className="block text-sm text-[var(--color-text-primary)] mb-2">Move Up / Down</label>
                            <div className="flex items-center gap-3">
                                <Move className="h-4 w-4 text-[var(--color-text-muted)]" />
                                <input
                                    type="range"
                                    min={-160}
                                    max={160}
                                    step={1}
                                    value={offsetY}
                                    onChange={(e) => {
                                        const clamped = clampOffsets(offsetX, Number(e.target.value));
                                        setOffsetX(clamped.x);
                                        setOffsetY(clamped.y);
                                    }}
                                    className="w-full accent-[var(--color-primary)]"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => {
                                setZoom(1);
                                setOffsetX(0);
                                setOffsetY(0);
                            }}
                            className="text-sm font-medium text-[var(--color-primary)] hover:underline transition-colors"
                        >
                            Reset
                        </button>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-xl border border-[var(--color-card-border)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={!imageElement}
                                className="rounded-xl bg-[var(--color-cta-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-cta-secondary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
