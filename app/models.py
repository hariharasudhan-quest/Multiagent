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


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    description: str
    status: TaskStatus = TaskStatus.OPEN
    created_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: Optional[datetime] = None
    iterations: int = 0 
    llm_outputs: list[str] = Field(default_factory=list)  

class TaskCreate(BaseModel):
    description: str



class LLMAction(str, Enum):
    CONTINUE_TASK = "CONTINUE_TASK"
    CLOSE_TASK = "CLOSE_TASK"


class LLMResponse(BaseModel):
    action: LLMAction
    reasoning: str = ""
    output: str = ""
