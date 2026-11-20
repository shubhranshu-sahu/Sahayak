"""
LLM Provider with Automatic Multi-Key & Multi-Model Failover.

Handles free-tier Gemini API limitations gracefully:
1. Per-account quota limits (429 RESOURCE_EXHAUSTED / Rate limit).
2. Temporary model high-demand spikes (503 UNAVAILABLE / Overloaded).
3. Transient connection or gateway timeouts (500, 502, 504, ReadTimeout).
4. Deprecated or unavailable models (404 NOT_FOUND).
5. Invalid key on one account failing over to a working key on another account.

Failover Strategy:
  For each model in priority order (models):
    For each API key (api_keys):
      Attempt invocation.
      If retryable error -> log warning & try next key.
    If all keys exhausted for this model -> try next model in priority order.
  If all (model, key) combinations are exhausted -> raise final exception.
"""

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from app.config import settings
from app.graph.sanitizer import sanitize_messages_for_gemini

logger = logging.getLogger(__name__)

# Keywords in exception messages that indicate a transient / retryable error
RETRYABLE_ERROR_KEYWORDS = (
    "quota",
    "resource_exhausted",
    "resourceexhausted",
    "rate limit",
    "ratelimit",
    "429",
    "503",
    "500",
    "502",
    "504",
    "unavailable",
    "overloaded",
    "capacity",
    "too many requests",
    "high demand",
    "spikes in demand",
    "deadline exceeded",
    "timeout",
    "timed out",
    "readtimeout",
    "connecttimeout",
    "connection reset",
    "temporarily unavailable",
    # Model not found or deprecated for this API version -> failover to next model
    "404",
    "not found",
    "not_found",
    "no longer available",
    "is not supported",
    # Key issues on one account -> failover to next key
    "api_key_invalid",
    "apikey_invalid",
    "permission_denied",
    "permissiondenied",
    "unauthenticated",
)


def mask_key(key: str) -> str:
    """Mask an API key for safe logging (e.g. '...UtmcQ')."""
    if not key:
        return "none"
    if len(key) <= 8:
        return "***"
    return f"...{key[-6:]}"


def is_retryable_error(error: Exception) -> bool:
    """
    Check if an error indicates a quota, availability, timeout, or model issue
    that warrants failing over to another API key or model.
    """
    err_type = type(error).__name__.lower()
    err_str = str(error).lower()

    # Known LangChain / Google SDK exception classes
    if any(
        target in err_type
        for target in (
            "ratelimit",
            "modelnotfound",
            "unavailable",
            "timeout",
            "internalservererror",
            "badgateway",
            "serviceunavailable",
        )
    ):
        return True

    # Check status_code attribute if present (e.g. httpx / google.genai errors)
    status_code = getattr(error, "status_code", None) or getattr(error, "code", None)
    if status_code in (429, 503, 500, 502, 504, 404):
        return True

    # String keyword search
    return any(kw in err_str for kw in RETRYABLE_ERROR_KEYWORDS)


class LLMProvider:
    """
    Manages a resilient pool of (api_key, model) combinations with automatic failover.
    Caches model instances and bindings to avoid re-instantiation overhead.
    """

    def __init__(self):
        self._current_model_idx: int = 0
        self._current_key_idx: int = 0
        self._tools: Optional[Sequence[Any]] = None
        # Instance cache keyed by (model, key_suffix, temperature, with_tools)
        self._cache: Dict[Tuple[str, str, float, bool], Any] = {}

    @property
    def api_keys(self) -> List[str]:
        """Dynamically fetched from settings (allows runtime updates)."""
        keys = settings.api_keys
        if not keys:
            logger.error("No valid Gemini API keys found in configuration!")
        return keys

    @property
    def models(self) -> List[str]:
        """Dynamically fetched from settings."""
        return settings.models

    @property
    def current_model(self) -> str:
        """The currently active/preferred model name."""
        models = self.models
        if not models:
            return "unknown"
        return models[self._current_model_idx % len(models)]

    @property
    def current_key_masked(self) -> str:
        """The currently active/preferred key (masked for safe display)."""
        keys = self.api_keys
        if not keys:
            return "none"
        return mask_key(keys[self._current_key_idx % len(keys)])

    def bind_tools(self, tools: Sequence[Any]) -> None:
        """Register the agent tools to be bound to LLM instances."""
        self._tools = tools

    def reset_indices(self) -> None:
        """Reset preference to the first model and first key."""
        self._current_model_idx = 0
        self._current_key_idx = 0

    def get_llm(
        self,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        temperature: float = 0.7,
        with_tools: bool = False,
    ) -> Any:
        """
        Get or create a cached ChatGoogleGenerativeAI instance.
        Uses max_retries=0 to ensure immediate failover without hanging on retries.
        """
        keys = self.api_keys
        models = self.models

        target_model = model or self.current_model
        target_key = api_key or (keys[self._current_key_idx % len(keys)] if keys else "")

        key_suffix = target_key[-8:] if target_key else "empty"
        cache_key = (target_model, key_suffix, round(temperature, 2), with_tools and bool(self._tools))

        if cache_key in self._cache:
            return self._cache[cache_key]

        # max_retries=0 allows our failover engine to instantly switch to the next key/model
        # instead of freezing the user's request with internal exponential backoff
        base_llm = ChatGoogleGenerativeAI(
            model=target_model,
            google_api_key=target_key,
            temperature=temperature,
            max_retries=0,
            timeout=45.0,
        )

        if with_tools and self._tools:
            instance = base_llm.bind_tools(self._tools)
        else:
            instance = base_llm

        self._cache[cache_key] = instance
        return instance

    async def ainvoke_with_failover(
        self,
        messages: Sequence[BaseMessage],
        temperature: float = 0.7,
        with_tools: bool = True,
        config: Optional[RunnableConfig] = None,
        on_failover: Optional[Callable[[str, str, str], Any]] = None,
    ) -> Any:
        """
        Invoke the LLM asynchronously with automatic failover across keys and models.

        Args:
            messages: List of LangChain messages to send.
            temperature: LLM temperature (e.g. 0.7 for chat, 0.3 for summary).
            with_tools: Whether to bind agent tools.
            config: Optional LangChain / LangGraph RunnableConfig.
            on_failover: Optional callback(model, masked_key, reason) invoked on failover.

        Returns:
            The AIMessage response from the successful LLM call.

        Raises:
            The last exception if all combinations are exhausted.
        """
        keys = self.api_keys
        models = self.models

        if not keys:
            raise RuntimeError("No Gemini API keys configured. Please set GEMINI_API_KEYS in .env.")
        if not models:
            raise RuntimeError("No Gemini models configured. Please set GEMINI_MODELS in .env.")

        # Sanitize messages to strictly adhere to Gemini turn order and function calling rules
        clean_messages = sanitize_messages_for_gemini(messages)

        total_keys = len(keys)
        total_models = len(models)
        max_attempts = total_keys * total_models
        attempts = 0
        last_error: Optional[Exception] = None

        # Priority 1: Outer loop iterates through models in order
        for model_offset in range(total_models):
            model_idx = (self._current_model_idx + model_offset) % total_models
            model = models[model_idx]

            # Priority 2: Inner loop iterates through all API keys for this model
            for key_offset in range(total_keys):
                key_idx = (self._current_key_idx + key_offset) % total_keys
                api_key = keys[key_idx]
                attempts += 1
                masked = mask_key(api_key)

                try:
                    llm = self.get_llm(
                        model=model,
                        api_key=api_key,
                        temperature=temperature,
                        with_tools=with_tools,
                    )

                    if config:
                        response = await llm.ainvoke(clean_messages, config=config)
                    else:
                        response = await llm.ainvoke(clean_messages)

                    # Success! Lock in working combination for subsequent calls
                    self._current_model_idx = model_idx
                    self._current_key_idx = key_idx

                    if attempts > 1:
                        logger.info(
                            "LLM failover recovered on attempt %d/%d (model=%s, key=%s)",
                            attempts,
                            max_attempts,
                            model,
                            masked,
                        )

                    return response

                except Exception as e:
                    last_error = e
                    if is_retryable_error(e):
                        reason = f"{type(e).__name__}: {str(e)[:120]}"
                        logger.warning(
                            "LLM attempt %d/%d failed (model=%s, key=%s): %s. Failing over...",
                            attempts,
                            max_attempts,
                            model,
                            masked,
                            reason,
                        )

                        if on_failover:
                            try:
                                if asyncio.iscoroutinefunction(on_failover):
                                    await on_failover(model, masked, reason)
                                else:
                                    on_failover(model, masked, reason)
                            except Exception as cb_err:
                                logger.debug("on_failover callback error: %s", cb_err)

                        # Tiny pause to avoid CPU spin
                        await asyncio.sleep(0.2)
                    else:
                        # Non-retryable error (e.g. malformed prompt / internal crash)
                        logger.error(
                            "LLM non-retryable error on attempt %d/%d (model=%s, key=%s): %s",
                            attempts,
                            max_attempts,
                            model,
                            masked,
                            e,
                            exc_info=True,
                        )
                        raise

        # All combinations exhausted
        logger.error(
            "All %d LLM failover attempts exhausted (%d models x %d keys). Last error: %s",
            max_attempts,
            total_models,
            total_keys,
            last_error,
        )
        raise last_error


# Global singleton provider instance
_provider: Optional[LLMProvider] = None


def get_llm_provider() -> LLMProvider:
    """Return the global LLMProvider singleton."""
    global _provider
    if _provider is None:
        _provider = LLMProvider()
    return _provider
