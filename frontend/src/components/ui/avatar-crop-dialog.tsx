"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { AppDialogShell } from "./app-dialog-shell";
import { LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";
import { useTranslations } from "@/i18n/react";
import type { Palette } from "@/features/file/model";

const stageSize = 280;
const outputSize = 256;

type CropOffset = {
  x: number;
  y: number;
};

type ImageInfo = {
  height: number;
  width: number;
};

export type AvatarCropDialogProps = {
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
  open: boolean;
  palette: Palette;
};

export function AvatarCropDialog({ imageSrc, onClose, onConfirm, open, palette }: AvatarCropDialogProps) {
  const t = useTranslations();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ offset: CropOffset; pointerId: number; x: number; y: number } | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const baseScale = imageInfo ? Math.max(stageSize / imageInfo.width, stageSize / imageInfo.height) : 1;
  const renderedSize = imageInfo
    ? {
        height: imageInfo.height * baseScale * zoom,
        width: imageInfo.width * baseScale * zoom,
      }
    : { height: stageSize, width: stageSize };
  const imageStyle = useMemo(
    () =>
      ({
        height: renderedSize.height,
        left: `calc(50% + ${offset.x}px)`,
        top: `calc(50% + ${offset.y}px)`,
        transform: "translate(-50%, -50%)",
        width: renderedSize.width,
      }) as CSSProperties,
    [offset.x, offset.y, renderedSize.height, renderedSize.width],
  );

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageInfo) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      offset,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !imageInfo) return;
    setOffset(
      clampOffset(
        {
          x: drag.offset.x + event.clientX - drag.x,
          y: drag.offset.y + event.clientY - drag.y,
        },
        imageInfo,
        zoom,
      ),
    );
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const confirmCrop = () => {
    const image = imageRef.current;
    if (!image || !imageInfo) return;

    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) return;

    const outputScale = outputSize / stageSize;
    const drawWidth = imageInfo.width * baseScale * zoom * outputScale;
    const drawHeight = imageInfo.height * baseScale * zoom * outputScale;
    const drawX = outputSize / 2 + offset.x * outputScale - drawWidth / 2;
    const drawY = outputSize / 2 + offset.y * outputScale - drawHeight / 2;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    onConfirm(canvas.toDataURL("image/jpeg", 0.9));
  };

  return (
    <AppDialogShell
      className="icedr-avatar-crop-dialog"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      size="sm"
    >
      <div className="icedr-avatar-crop-shell">
        <header className="icedr-avatar-crop-header">
          <span>{t("settings.avatar")}</span>
          <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
            <LocalIcon name="cross" size={17} />
          </ToolButton>
        </header>

        <div
          className="icedr-avatar-crop-stage"
          onPointerCancel={endDrag}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          ref={stageRef}
          style={{
            "--avatar-crop-bg": palette.surface2,
            "--avatar-crop-border": palette.hairlineStrong,
            "--avatar-crop-ring": palette.primaryHover,
          } as CSSProperties}
        >
          {imageSrc ? (
            <img
              alt=""
              className="icedr-avatar-crop-image"
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                const nextImageInfo = {
                  height: image.naturalHeight || stageSize,
                  width: image.naturalWidth || stageSize,
                };
                setImageInfo(nextImageInfo);
                setOffset(clampOffset({ x: 0, y: 0 }, nextImageInfo, zoom));
              }}
              ref={imageRef}
              src={imageSrc}
              style={imageStyle}
            />
          ) : null}
          <div className="icedr-avatar-crop-mask" aria-hidden="true" />
        </div>

        <label className="icedr-avatar-crop-zoom">
          <LocalIcon name="search" size={15} color={palette.subtle} />
          <input
            aria-label={t("settings.avatarZoom")}
            disabled={!imageInfo}
            max={3}
            min={1}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              setZoom(nextZoom);
              if (imageInfo) setOffset((current) => clampOffset(current, imageInfo, nextZoom));
            }}
            step={0.01}
            type="range"
            value={zoom}
          />
        </label>

        <footer className="icedr-avatar-crop-actions">
          <ToolButton label={t("share.cancel")} palette={palette} onClick={onClose} visual="surface">
            <LocalIcon name="cross" size={17} />
          </ToolButton>
          <ToolButton disabled={!imageInfo} label={t("settings.avatarApply")} palette={palette} onClick={confirmCrop} tone="success" visual="surface">
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </footer>
      </div>
    </AppDialogShell>
  );
}

function clampOffset(offset: CropOffset, imageInfo: ImageInfo, zoom: number) {
  const baseScale = Math.max(stageSize / imageInfo.width, stageSize / imageInfo.height);
  const width = imageInfo.width * baseScale * zoom;
  const height = imageInfo.height * baseScale * zoom;
  const maxX = Math.max(0, (width - stageSize) / 2);
  const maxY = Math.max(0, (height - stageSize) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}
