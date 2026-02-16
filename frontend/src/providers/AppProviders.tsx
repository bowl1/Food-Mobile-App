import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import React, { PropsWithChildren, useState } from 'react';

import { useBootstrap } from '@/hooks/useBootstrap';
import { querySqliteStorage } from '@/storage/querySqliteStorage';

const OFFLINE_QUERY_ROOT_KEYS = new Set(['favorites', 'profile']);

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());
  const [queryPersister] = useState(() =>
    createAsyncStoragePersister({
      storage: querySqliteStorage,
      key: 'fridge-to-food-query-cache',
    }),
  );

  useBootstrap();

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' && OFFLINE_QUERY_ROOT_KEYS.has(String(query.queryKey[0] ?? '')),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
