from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


TaskType = Literal["exterior", "interior"]


EXTERIOR_PROMPT = (
    "Generate one output image for each uploaded car exterior reference image. "
    "If multiple exterior reference images are provided, every single uploaded exterior image must be processed, "
    "and none of them can be skipped or omitted. Maintain a strict one-to-one mapping: one reference image = one "
    "generated image. Keep the car body completely unchanged in each image, including body shape, proportions, paint "
    "color, trim, wheels, headlights, taillights, windows, mirrors, and all exterior design details. Do not alter the "
    "vehicle appearance in any way. Change the scene to a premium pure white luxury automotive showroom with a "
    "seamless curved white backdrop, polished white reflective floor, subtle architectural layering, soft ambient "
    "reflections, hidden linear ceiling lights, diffused studio lighting, and a clean high-end exhibition atmosphere. "
    "The showroom should feel elegant, modern, minimal, premium, and suitable for commercial car advertising, while "
    "still keeping the background clean and not distracting from the car. Do not alter the style of the product logo. "
    "Add the logo from the second reference image to the license plate area. Also add the same logo in the top-left "
    "corner of each generated image. Do not generate multiple angles from one reference. Generate exactly one result "
    "for each uploaded reference image. Preserve the original viewing angle and composition of each reference image. "
    "Photorealistic, professional automotive photography, ultra-detailed, premium commercial quality. Output size: "
    "1024x1024."
)

INTERIOR_PROMPT = (
    "Strictly use the uploaded interior reference images to create collage outputs. Do not change the original camera "
    "angle. Do not generate new scenes. Do not crop one image into multiple close-up panels. Each panel must correspond "
    "to a different uploaded original image. Each uploaded image can be used only once, and all uploaded images must "
    "be used. If 1 to 3 images are uploaded, generate 1 collage. If 4 images are uploaded, generate 2 collages in a "
    "2 plus 2 grouping. If 5 images are uploaded, generate 2 collages in a 3 plus 2 grouping. Use a clean and tidy "
    "grid or side-by-side layout with clear separation between panels. Keep the original images complete and sharp, "
    "without stretching or overlap. Professional automotive interior collage style. Output size: 1024x1024."
)


@dataclass(frozen=True)
class NormalizedSubmission:
    submission_id: str
    run_id: str
    workflow_code: str
    client_request_id: str
    callback_url: str
    callback_token: str
    car_name: str
    logo: str
    source: str
    submitted_at: str
    user_id: str
    feishu_app_id: str
    feishu_id: str
    exterior_images: list[str]
    interior_images: list[str]
    interior_groups: list[list[str]]
    expected_tasks: int


@dataclass(frozen=True)
class TaskItem:
    submission_id: str
    run_id: str
    workflow_code: str
    client_request_id: str
    callback_url: str
    callback_token: str
    car_name: str
    logo: str
    feishu_app_id: str
    feishu_id: str
    expected_tasks: int
    type: TaskType
    index: int | None = None
    image_url: str | None = None
    group_index: int | None = None
    image_urls: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ParsedKieCallback:
    task_id: str
    state: str
    raw_state: str
    result_url: str | None
    fail_code: str | None
    fail_msg: str | None
    body: dict[str, Any]
