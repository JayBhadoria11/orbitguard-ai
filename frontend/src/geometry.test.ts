import { expect, it } from 'vitest';
import { containRect, imagePoint, selectionBox } from './geometry';
it('maps a letterboxed 4:3 image to exact source coordinates', () => {
  const box = { x: 10, y: 20, width: 800, height: 400 };
  expect(containRect(box, 640, 480).width).toBeCloseTo(533.333);
  expect(imagePoint({ x: 410, y: 220 }, box, 640, 480)).toEqual({ x: 320, y: 240 });
  expect(imagePoint({ x: 20, y: 220 }, box, 640, 480)).toBeNull();
  expect(imagePoint({ x: 20, y: 220 }, box, 640, 480, true)?.x).toBe(0);
});
it('handles portrait containers, responsive scaling and reverse-direction ROI gestures', () => {
  expect(imagePoint({ x: 100, y: 200 }, { x: 0, y: 0, width: 200, height: 400 }, 640,480)).toEqual({ x:320,y:240 });
  expect(selectionBox({x:100.3,y:80.5},{x:20.2,y:30.1})).toEqual({x:20,y:30,width:81,height:51});
});
