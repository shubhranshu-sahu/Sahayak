from typing import List
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Base directory: ai-service root
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Application configuration loaded from environment variables and .env file."""

    # Google Gemini LLM Settings (Multi-Key & Multi-Model Failover)
    GEMINI_API_KEYS: str = Field(
        default="",
        description="Comma-separated list of Gemini API keys from different accounts",
    )
    GEMINI_MODELS: str = Field(
        default="gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash,gemini-flash-latest",
        description="Comma-separated list of Gemini models in priority failover order",
    )

    # Backward compatibility: Single key & model fallback
    GEMINI_API_KEY: str = Field(
        default="",
        description="Single Gemini API key fallback if GEMINI_API_KEYS is not set",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-3.5-flash",
        description="Single Gemini model fallback if GEMINI_MODELS is not set",
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

    # MySQL Settings (for agent tools — direct DB access)
    MYSQL_HOST: str = Field(
        default="localhost",
        description="MySQL host for agent tool execution",
    )
    MYSQL_PORT: int = Field(
        default=3306,
        description="MySQL port",
    )
    MYSQL_USER: str = Field(
        default="root",
        description="MySQL user",
    )
    MYSQL_PASSWORD: str = Field(
        default="",
        description="MySQL password",
    )
    MYSQL_DATABASE: str = Field(
        default="sahayak_db",
        description="MySQL database name",
    )
    MYSQL_POOL_SIZE: int = Field(
        default=5,
        description="MySQL connection pool size",
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
    def api_keys(self) -> List[str]:
        """
        Parse comma-separated API keys into a sanitized, deduplicated list.
        Falls back to GEMINI_API_KEY if GEMINI_API_KEYS is empty.
        Filters out empty strings and placeholder values.
        """
        raw_keys = [
            k.strip().strip('"').strip("'")
            for k in self.GEMINI_API_KEYS.split(",")
            if k.strip()
        ]
        # Filter placeholders
        valid_keys = [k for k in raw_keys if k and k != "your_gemini_api_key_here"]

        if not valid_keys and self.GEMINI_API_KEY and self.GEMINI_API_KEY != "your_gemini_api_key_here":
            valid_keys = [self.GEMINI_API_KEY.strip().strip('"').strip("'")]

        # Deduplicate while preserving priority order
        return list(dict.fromkeys(valid_keys))

    @property
    def models(self) -> List[str]:
        """
        Parse comma-separated model names into a list in priority order.
        Falls back to GEMINI_MODEL or default model list if empty.
        """
        raw_models = [
            m.strip().strip('"').strip("'")
            for m in self.GEMINI_MODELS.split(",")
            if m.strip()
        ]
        if not raw_models and self.GEMINI_MODEL:
            raw_models = [self.GEMINI_MODEL.strip().strip('"').strip("'")]

        # Fallback default if completely empty
        if not raw_models:
            raw_models = [
                "gemini-3.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-flash-lite-latest",
                "gemini-3.8-flash",
                "gemini-flash-latest",
            ]

        # Deduplicate while preserving priority order
        return list(dict.fromkeys(raw_models))

    @property
    def is_gemini_configured(self) -> bool:
        """Helper to verify if at least one valid Gemini API key is configured."""
        return len(self.api_keys) > 0


# Global singleton settings instance
settings = Settings()
