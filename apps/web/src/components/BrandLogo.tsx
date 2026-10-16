import { Image, useMantineColorScheme } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

/** شعار الشركة في شريط التطبيق (بالسمة واللغة)؛ لا يعرض شيئاً إن لم يُرفع شعار. */
export const BrandLogo = ({ height = 32 }: { height?: number }) => {
  const { i18n } = useTranslation();
  const { colorScheme } = useMantineColorScheme();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const theme = colorScheme === 'dark' ? 'dark' : 'light';
  const q = useQuery({
    queryKey: ['/company-brand', 'logo', lang, theme],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await api.blob('/company-brand/logo', { lang, theme }));
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
  });
  const url = q.data;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (!url) return null;
  return <Image src={url} alt="" h={height} w="auto" fit="contain" />;
};
