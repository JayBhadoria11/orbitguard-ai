import type { Box, Point } from './types';

export function containRect(box: Box, imageWidth: number, imageHeight: number): Box {
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const width = imageWidth * scale, height = imageHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

export function imagePoint(client: Point, box: Box, width: number, height: number, clamp = false): Point | null {
  const rect = containRect(box, width, height);
  if (!rect.width || !rect.height) return null;
  const x = (client.x - rect.x) * width / rect.width, y = (client.y - rect.y) * height / rect.height;
  if (!clamp && (x < 0 || y < 0 || x > width || y > height)) return null;
  return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
}

export function selectionBox(a: Point, b: Point): Box {
  const x = Math.floor(Math.min(a.x, b.x)), y = Math.floor(Math.min(a.y, b.y));
  return { x, y, width: Math.ceil(Math.max(a.x, b.x)) - x, height: Math.ceil(Math.max(a.y, b.y)) - y };
}
