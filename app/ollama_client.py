import json
# pyrefly: ignore [missing-import]
import httpx
from .models import LLMResponse, LLMAction

OLLAMA_BASE_URL = "http://localhost:11434"
MODEL_NAME = "qwen3:8b"

MAX_ITERATIONS_PER_TASK = 5

SYSTEM_PROMPT = """You are an AI task-processing agent. You receive tasks and must decide what to do with them.

You MUST respond with ONLY valid JSON in this exact format, no other text:

{
  "action": "CLOSE_TASK" or "CONTINUE_TASK",
  "reasoning": "your reasoning for this decision",
  "output": "any output or work product for this task"
}

Rules:
1. ALWAYS respond with valid JSON only. No markdown, no code fences, no extra text.
2. "action" must be exactly "CLOSE_TASK" or "CONTINUE_TASK".
3. If you can provide a complete response to the task, use "CLOSE_TASK".
4. If the task needs more iterations to complete, use "CONTINUE_TASK" with partial progress in "output".
5. For this prototype, you are demonstrating task processing — provide a thoughtful analysis or plan as output.
6. Do NOT wrap your response in ```json``` blocks. Just raw JSON.

/no_think"""


def build_task_prompt(task_description: str, iteration: int, previous_outputs: list[str]) -> str:
    prompt = f"TASK: {task_description}\n\nIteration: {iteration + 1}/{MAX_ITERATIONS_PER_TASK}\n"

    if previous_outputs:
        prompt += "\nPrevious work on this task:\n"
        for i, output in enumerate(previous_outputs, 1):
            prompt += f"  Iteration {i}: {output[:200]}...\n" if len(output) > 200 else f"  Iteration {i}: {output}\n"

    prompt += "\nProcess this task and respond with the required JSON format."
    return prompt


async def call_ollama(prompt: str) -> LLMResponse:

    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "system": SYSTEM_PROMPT,
        "stream": False,
        "options": {
            "temperature": 0.7,
            "num_predict": 1024,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json=payload,
            )
            response.raise_for_status()

        raw = response.json()["response"].strip()
        print(f"  Raw LLM response: {raw[:300]}...")

        json_str = _extract_json(raw)
        parsed = json.loads(json_str)

        return LLMResponse(
            action=LLMAction(parsed.get("action", "CLOSE_TASK")),
            reasoning=parsed.get("reasoning", ""),
            output=parsed.get("output", ""),
        )

    except httpx.ConnectError:
        print("  Cannot connect to Ollama. Is it running? (ollama serve)")
        return LLMResponse(
            action=LLMAction.CLOSE_TASK,
            reasoning="ERROR: Cannot connect to Ollama server",
            output="Ollama is not running. Start it with: ollama serve",
        )
    except Exception as e:
        print(f"  Error parsing LLM response: {e}")
        return LLMResponse(
            action=LLMAction.CLOSE_TASK,
            reasoning=f"Failed to parse LLM response: {str(e)}",
            output=raw if 'raw' in dir() else "No response received",
        )


def _extract_json(text: str) -> str:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        return text[start:end + 1]

    return text.strip()
