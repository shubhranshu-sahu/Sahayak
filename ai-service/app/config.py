from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Base directory: ai-service root
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Application configuration loaded from environment variables and .env file."""

    # Google Gemini LLM Settings
    GEMINI_API_KEY: str = Field(
        default="",
        description="Google Gemini API key required for LLM calls",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-1.5-flash",
        description="Gemini model name to use",
    )

    # MongoDB Settings
    MONGODB_URI: str = Field(
        default="mongodb://localhost:27017",
        description="MongoDB connection string",
    )
    MONGODB_DB_NAME: str = Field(
        default="sahayak_ai",
        description="MongoDB database name",
    )

    # MongoDB Collection Names
    # 1. agent_threads: Auto-managed by LangGraph MongoDBSaver checkpointer (sliding window)
    # 2. chat_messages: Managed by our app for permanent full chat history & UI display
    AGENT_THREADS_COLLECTION: str = Field(
        default="agent_threads",
        description="LangGraph MongoDBSaver checkpoint collection (sliding window)",
    )
    CHAT_MESSAGES_COLLECTION: str = Field(
        default="chat_messages",
        description="Permanent full chat history collection for UI display",
    )

    # Summarization Configuration
    # Trigger summarization when window exceeds 30 messages
    # Keep the last 5 messages as conversational overlap
    MAX_WINDOW_MESSAGES: int = Field(
        default=30,
        description="Message count threshold to trigger summarization at start of next invocation",
    )
    OVERLAP_MESSAGES: int = Field(
        default=5,
        description="Number of recent messages retained as context overlap during summarization",
    )

    # Server Settings
    HOST: str = Field(default="0.0.0.0", description="Service host binding")
    PORT: int = Field(default=8001, description="Service port")
    ENVIRONMENT: str = Field(default="development", description="Runtime environment")

    # JWT Authentication (Shared secret with Node.js backend)
    JWT_SECRET: str = Field(
        default="sahayak_super_secret_jwt_key_shared_2026",
        description="Shared secret key for verifying backend issued JWTs",
    )
    JWT_ALGORITHM: str = Field(
        default="HS256",
        description="JWT cryptographic signing algorithm",
    )

    # Pydantic Settings configuration: auto-load .env from ai-service root
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def is_gemini_configured(self) -> bool:
        """Helper to verify if a non-placeholder Gemini API key is configured."""
        return bool(self.GEMINI_API_KEY and self.GEMINI_API_KEY != "your_gemini_api_key_here")


# Global singleton settings instance
settings = Settings()
