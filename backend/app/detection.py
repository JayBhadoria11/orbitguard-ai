"""Calibrated prop-color segmentation, not semantic object recognition."""
import math
import cv2
import numpy as np
from .frame_processing import reject
from .vision_config import MIN_AREA_FRACTION, MAX_AREA_FRACTION, MAX_TRACKS
from .vision_models import Box, EarthResult, Measurement, Point, ProfileInfo, ROI


def hue_distance(a, b):
    return np.abs((np.asarray(a, dtype=float) - b + 90) % 180 - 90)


def mask_for(hsv, profile):
    # OpenCV performs the full-frame threshold in native code without float-array copies.
    low = profile.hue_center - profile.hue_half_width
    high = profile.hue_center + profile.hue_half_width
    def band(lo, hi):
        return cv2.inRange(hsv, (math.ceil(lo), profile.saturation_min, profile.value_min), (math.floor(hi), 255, 255))
    if low < 0:
        mask = cv2.bitwise_or(band(0, high), band(low + 180, 179))
    elif high >= 180:
        mask = cv2.bitwise_or(band(low, 179), band(0, high - 180))
    else:
        mask = band(low, high)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def contours(mask):
    return cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]


def circularity(contour):
    perimeter = cv2.arcLength(contour, True)
    return 4 * math.pi * cv2.contourArea(contour) / max(1, perimeter * perimeter)


def measurement(contour, profile_id):
    moments = cv2.moments(contour)
    x, y, w, h = cv2.boundingRect(contour)
    return Measurement(profile_id=profile_id, center=Point(x=moments['m10'] / moments['m00'],
                       y=moments['m01'] / moments['m00']), bbox=Box(x=x, y=y, width=w, height=h),
                       area_px=cv2.contourArea(contour))


def calibrate(image, roi: ROI, profile_id, existing):
    height, width = image.shape[:2]
    x, y, w, h = roi.x, roi.y, roi.width, roi.height
    if w < 8 or h < 8 or x + w > width or y + h > height:
        reject(400, 'INVALID_ROI', 'Select a rectangle at least 8 × 8 pixels entirely inside the snapshot.')
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    crop = hsv[y:y+h, x:x+w]
    central = crop[h//5:h-h//5, w//5:w-w//5].reshape(-1, 3)
    usable = central[(central[:, 1] >= 70) & (central[:, 2] >= 45)]
    if len(usable) < max(30, len(central) * 0.45):
        reject(400, 'UNSUITABLE_COLOR', 'Too few saturated foreground pixels. Select a tight ROI on a matte, brightly colored prop.')
    angles = usable[:, 0].astype(float) * (2 * math.pi / 180)
    vector = np.mean(np.exp(1j * angles))
    center = float(np.angle(vector) * 180 / (2 * math.pi) % 180)
    spread = float(np.percentile(hue_distance(usable[:, 0], center), 95))
    if abs(vector) < 0.92 or spread > 12:
        reject(400, 'AMBIGUOUS_COLOR', 'Selection contains broad or mixed hues. Choose one solid-colored prop without reflections.')
    profile = ProfileInfo(profile_id=profile_id, hue_center=center, hue_half_width=min(18, max(6, spread + 4)),
                          saturation_min=max(60, int(np.percentile(usable[:, 1], 10)) - 45),
                          value_min=max(35, int(np.percentile(usable[:, 2], 10)) - 65), reference_area_px=0)
    for other in existing.values():
        if other.profile_id != profile_id and hue_distance(center, other.hue_center) <= profile.hue_half_width + other.hue_half_width + 4:
            reject(409, 'COLOR_CONFLICT', f'Color overlaps {other.profile_id}. Use a distinctly different prop color or reset that scene.')
    local_mask = mask_for(crop, profile)
    found = sorted(contours(local_mask), key=cv2.contourArea, reverse=True)
    area = cv2.contourArea(found[0]) if found else 0
    total = sum(cv2.contourArea(c) for c in found)
    if area < max(25, w*h*0.2) or area < total * 0.7:
        reject(400, 'INVALID_COMPONENT', 'No single meaningful foreground component. Tighten the rectangle around one separated prop.')
    if profile_id == 'earth' and circularity(found[0]) < 0.45:
        reject(400, 'EARTH_SHAPE', 'Earth should be approximately round. Select the blue ball, not its shadow or background.')
    profile.reference_area_px = area
    mask = np.zeros((height, width), np.uint8)
    mask[y:y+h, x:x+w] = local_mask
    contour = found[0] + np.array([[[x, y]]])
    simplified = cv2.approxPolyDP(contour, max(1, cv2.arcLength(contour, True) * 0.008), True)
    return profile, mask, [Point(x=float(p[0][0]), y=float(p[0][1])) for p in simplified]


def detect(image, profiles, recent_earth=None):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    height, width = image.shape[:2]
    pixels = height * width
    earth = EarthResult(status='uncalibrated')
    if 'earth' in profiles:
        profile = profiles['earth']
        candidates = []
        for contour in contours(mask_for(hsv, profile)):
            area = cv2.contourArea(contour)
            if not (max(25, profile.reference_area_px * 0.35) <= area <= min(pixels * 0.5, profile.reference_area_px * 2.8)) or circularity(contour) < 0.45:
                continue
            (cx, cy), radius = cv2.minEnclosingCircle(contour)
            score = abs(math.log(area / profile.reference_area_px))
            if recent_earth:
                score += math.hypot(cx-recent_earth.x, cy-recent_earth.y) / math.hypot(width, height) * 3
            candidates.append((score, cx, cy, radius, contour))
        candidates.sort(key=lambda c: (c[0], c[1], c[2]))
        earth = EarthResult(status='not_detected')
        if len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 0.25:
            earth = EarthResult(status='ambiguous')
        elif candidates:
            _, cx, cy, radius, contour = candidates[0]
            earth = EarthResult(status='detected', center=Point(x=cx, y=cy), radius_px=radius,
                                bbox=measurement(contour, 'earth').bbox)
    debris = []
    for key, profile in sorted(profiles.items()):
        if key == 'earth':
            continue
        mask = mask_for(hsv, profile)
        if earth.center is not None:
            cv2.circle(mask, (round(earth.center.x), round(earth.center.y)), math.ceil(earth.radius_px + 4), 0, -1)
        for contour in contours(mask):
            area = cv2.contourArea(contour)
            if max(12, pixels * MIN_AREA_FRACTION, profile.reference_area_px * 0.12) <= area <= min(pixels * MAX_AREA_FRACTION, profile.reference_area_px * 4):
                debris.append(measurement(contour, key))
    debris.sort(key=lambda d: (d.profile_id, d.center.x, d.center.y))
    warnings = []
    if len(debris) > MAX_TRACKS:
        warnings.append(f'Only the first {MAX_TRACKS} detections are processed; reduce the number of props.')
    if earth.status == 'ambiguous':
        warnings.append('Multiple plausible Earth props. Remove same-colored distractors and recalibrate if needed.')
    return earth, debris[:MAX_TRACKS], warnings
