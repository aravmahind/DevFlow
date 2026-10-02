import os
import asyncio
from pydantic import BaseModel
from llm.client import GROQ_API_KEY
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

class ExecutiveSummary(BaseModel):
    product_name: str
    tagline: str
    vision: str
    business_goals: list[str]
    target_audience: list[str]
    competitive_landscape: str
    go_to_market: str
    key_decisions: list[str]
    complexity_score: int
    estimated_duration_weeks: int
    team_size: int

async def main():
    chat = ChatGroq(
        model="openai/gpt-oss-120b",
        groq_api_key=os.environ.get("GROQ_API") or GROQ_API_KEY,
        max_tokens=2500,
    )
    generator = chat.with_structured_output(ExecutiveSummary, method="json_mode")
    
    print("Sending request...")
    try:
        res = await generator.ainvoke([
            SystemMessage(content="You are a CEO. Create a detailed executive summary for a new AI interview prep platform. Output ONLY valid JSON matching the schema."),
            HumanMessage(content="Idea: An AI interview prep platform.")
        ])
        print("Success!")
        print(res)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv("../.env")
    asyncio.run(main())
