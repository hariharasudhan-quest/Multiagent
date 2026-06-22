from __future__ import annotations

from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime
import uuid


class TaskStatus(str, Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    CLOSED = "CLOSED"


class TaskPhase(str, Enum):
    PENDING = "PENDING"
    ARCHITECT = "ARCHITECT"
    CODER = "CODER"
    REVIEWER = "REVIEWER"
    FIX = "FIX"
    DONE = "DONE"


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    description: str
    status: TaskStatus = TaskStatus.OPEN
    phase: TaskPhase = TaskPhase.PENDING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: Optional[datetime] = None
    iterations: int = 0
    files_created: List[str] = Field(default_factory=list)
    plan: str = ""
    review_verdict: str = ""
    review_details: str = ""
    phase_outputs: List[dict] = Field(default_factory=list)


class TaskCreate(BaseModel):
    description: str


class Trace(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    task_id: str
    mode: str
    model: str = "ollama/qwen3:8b"
    latency_ms: int = 0
    tool_calls: List[dict] = Field(default_factory=list)
    files_modified: List[str] = Field(default_factory=list)
    event_count: int = 0
    text_output: str = ""
    success: bool = True
    error: str = ""
