import asyncio
import structlog
from temporalio.client import Client

from .config import settings
from .system_schedules import setup_system_schedules

logger = structlog.get_logger()

async def wait_for_temporal():
    """Wait for Temporal service to be available."""
    logger.info("waiting_for_temporal", address=settings.temporal_address)
    
    retries = 30
    delay = 1
    
    for i in range(retries):
        try:
            await Client.connect(
                settings.temporal_address,
                namespace=settings.temporal_namespace,
            )
            logger.info("temporal_connection_successful")
            return True
        except Exception as e:
            if i == retries - 1:
                logger.error("temporal_connection_failed", error=str(e))
                raise
            
            logger.debug("temporal_connection_retry", attempt=i+1, error=str(e))
            await asyncio.sleep(delay)

async def main():
    """Run startup tasks."""
    try:
        # 1. Wait for Temporal
        await wait_for_temporal()
        print("✅ Temporal service is ready!")
        
        # 2. Run System Schedule Setup
        print("Setting up system schedules...")
        await setup_system_schedules()
        
    except Exception as e:
        logger.error("startup_failed", error=str(e))
        print(f"❌ Startup failed: {e}")
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())
