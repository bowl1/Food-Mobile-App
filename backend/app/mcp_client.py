import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from fastapi import HTTPException


@asynccontextmanager
async def tools_for(identity):
    # Dedicated process per request. JWT is trusted transport context, never a model argument.
    root = Path(__file__).resolve().parents[2]
    parameters = StdioServerParameters(command=sys.executable, args=[str(root / 'mcp-server/server.py')],
        env={**os.environ, 'PYTHONPATH': str(root), 'FRIDGECHEF_USER_TOKEN': identity.token}, cwd=str(root))
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            async def call(name, arguments=None):
                result = await session.call_tool(name, arguments or {})
                if result.isError:
                    raise HTTPException(503, 'Inventory tools unavailable. Please retry.')
                import json
                import logging
                logging.getLogger('fridgechef').info('tool_call name=%s', name)
                # Explicit JSON text return makes tool serialization independent of SDK structured wrappers.
                for block in result.content:
                    if block.type == 'text':
                        return json.loads(block.text)
                raise HTTPException(503, 'Invalid response from inventory tools.')
            yield call
