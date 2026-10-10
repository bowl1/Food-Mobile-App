import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, DEMO, Recipe } from './api';
import { queuedImageRequest } from './imageQueue';
import { cachedImage, storeImage, removeCachedImage } from './imageCache';
import { SketchBorder } from './SketchPaper';
import { foodArt, palette } from './theme';

type ImageResult = { status: 'ready' | 'generating' | 'queued' | 'failed' | 'unavailable'; retry_after?: number; client_started_at?: number; url?: string; thumbnail_url?: string };

export function RecipePhoto({ recipe, userId, detail = false }: { recipe: Recipe; userId: string; detail?: boolean }) {
  const retry = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pollRound, setPollRound] = useState(0);
  const pollingStarted = useRef<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [waitingForSlot, setWaitingForSlot] = useState(false);
  const [pollExpired, setPollExpired] = useState(false);
  useEffect(() => {
    setPollExpired(false);
    if (startedAt === null) return;
    const timer = setTimeout(() => setPollExpired(true), Math.max(0, 180000 - (Date.now() - startedAt)));
    return () => clearTimeout(timer);
  }, [startedAt, pollRound]);
  useEffect(() => {
    pollingStarted.current = null;
    setStartedAt(null);
    setPollExpired(false);
    setLoadFailed(false);
  }, [recipe.id]);
  const image = useQuery({
    queryKey: ['chef-recipe-image', userId, recipe.id, detail ? 'full' : 'thumb'],
    queryFn: async () => {
      const local = await cachedImage(userId, recipe.id, detail);
      if (local && !retry.current) return { status: 'ready' as const, url: local, thumbnail_url: local };
      // Existing images only need a signed URL; they never wait behind model work.
      const request = async () => {
          setWaitingForSlot(false);
          if (pollingStarted.current === null) {
            pollingStarted.current = Date.now();
            setStartedAt(pollingStarted.current);
          }
          const manualRetry = retry.current;
          retry.current = false;
          const result = await api<ImageResult>(`/recipes/${recipe.id}/image${manualRetry ? '?retry=true' : ''}`, 'POST');
          if (result.status === 'queued') {
            pollingStarted.current = null;
            setStartedAt(null);
          }
          if (result.status === 'ready') {
            const remote = detail ? result.url : result.thumbnail_url ?? result.url;
            const saved = remote ? await storeImage(userId, recipe.id, detail, remote) : undefined;
            if (saved) return { ...result, url: saved, thumbnail_url: saved };
          }
          return { ...result, client_started_at: pollingStarted.current ?? undefined };
      };
      if (recipe.image_status === 'ready') return request();
      setWaitingForSlot(true);
      try { return await queuedImageRequest(request); }
      finally { setWaitingForSlot(false); }
    },
    enabled: !recipe.preview_only && !DEMO && !!recipe.image_status && recipe.image_status !== 'none',
    retry: (count, error) => count < 2 && (error instanceof TypeError ||
      (error instanceof ApiError && error.status >= 500 && error.jobState !== 'failed')),
    retryDelay: 2000,
    staleTime: 50 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: query => query.state.data?.status === 'queued'
      ? (query.state.data.retry_after ?? 10) * 1000
      : !pollExpired && query.state.data?.status === 'generating'
        ? Math.min(30000, 5000 * 2 ** Math.min(3, Math.floor((Date.now() - (pollingStarted.current ?? Date.now())) / 30000))) : false,
  });
  useEffect(() => {
    if (image.data?.status === 'queued') {
      pollingStarted.current = null;
      setStartedAt(null);
    } else if (image.data?.status === 'generating' && pollingStarted.current === null) {
      pollingStarted.current = image.data.client_started_at ?? Date.now();
      setStartedAt(pollingStarted.current);
    }
  }, [image.data]);
  const queued = waitingForSlot || image.data?.status === 'queued';
  const busy = image.isFetching || queued || (!pollExpired && image.data?.status === 'generating');
  const url = detail ? image.data?.url : (image.data?.thumbnail_url ?? image.data?.url);
  const failed = !!image.error || image.data?.status === 'failed' || loadFailed || (pollExpired && image.data?.status === 'generating');
  return <View style={detail ? { gap: 8 } : { width: '100%', height: '100%' }}>
    <View style={{ width: '100%', height: detail ? 280 : '100%', backgroundColor: '#FFF6DF', overflow: 'hidden', borderRadius: detail ? 24 : 0 }}>
      {url && !loadFailed ? <Image source={{ uri: url }} accessibilityLabel={`AI generated image of ${recipe.recipe_name}`} resizeMode="cover" style={{ width: '100%', height: '100%' }} onError={() => setLoadFailed(true)} /> : <>
        <Image source={foodArt} accessible={false} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        <View style={{ position: 'absolute', right: 12, top: 14, backgroundColor: palette.cream, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }}><Text style={{ color: palette.muted, fontSize: 9 }}>Kitchen illustration</Text></View>
        <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#FFFDF5F2', borderTopLeftRadius: 18, borderTopRightRadius: 12, borderBottomLeftRadius: 12, borderBottomRightRadius: 19, padding: 12, alignItems: 'center', gap: 7 }}><SketchBorder />
          {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={palette.orange} /><Text style={{ color: palette.ink, fontSize: 12 }}>{queued ? 'Your dish image is queued…' : recipe.image_status === 'ready' ? 'Loading your saved image…' : 'Creating your dish image…'}</Text></View> : <>
            <Text style={{ color: palette.ink, fontSize: 12, textAlign: 'center' }}>{recipe.preview_only ? 'Your recipe is ready to read. Images follow shortly.' : DEMO ? 'Your dish image appears in live mode' : failed ? (image.error instanceof Error ? image.error.message : 'Your recipe is saved. Try its image again.') : 'Bring this recipe to life'}</Text>
            {!DEMO && !recipe.preview_only && <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Retry recipe image' : 'Generate recipe image'} onPress={event => { event.stopPropagation(); setLoadFailed(false); pollingStarted.current = null; setStartedAt(null); setPollExpired(false); setPollRound(round => round + 1); retry.current = true; void removeCachedImage(userId, recipe.id).then(() => image.refetch()); }} style={{ paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12, backgroundColor: palette.orange }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{failed ? 'Retry image' : 'Generate image'}</Text></Pressable>}
          </>}
        </View>
      </>}
      {url && !loadFailed && <View style={{ position: 'absolute', bottom: 12, left: 12, backgroundColor: '#173C35E8', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}><Text style={{ color: palette.cream, fontSize: 10 }}>AI generated</Text></View>}
    </View>
    {detail && <Text style={{ fontSize: 11, color: palette.muted }}>{url ? 'AI-generated recipe image. Actual results may differ.' : 'Decorative kitchen illustration; your recipe image is not ready yet.'}</Text>}
  </View>;
}
