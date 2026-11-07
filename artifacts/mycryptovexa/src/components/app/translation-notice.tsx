import { useTranslation } from 'react-i18next';

const notices:Record<string,string>={
  es:'Traducción parcial: algunas páginas y artículos de ayuda siguen en inglés.',
  fr:'Traduction partielle : certaines pages et certains articles restent en anglais.',
  pt:'Tradução parcial: algumas páginas e artigos de ajuda ainda estão em inglês.',
  ar:'الترجمة غير مكتملة: لا تزال بعض الصفحات ومقالات المساعدة باللغة الإنجليزية.',
  sw:'Tafsiri haijakamilika: baadhi ya kurasa na makala za msaada bado ziko kwa Kiingereza.',
  zh:'翻译尚未完成：部分页面和帮助文章仍以英语显示。',
  hi:'अनुवाद अधूरा है: कुछ पृष्ठ और सहायता लेख अभी भी अंग्रेज़ी में हैं।',
};
export function TranslationNotice(){
  const {i18n}=useTranslation();
  const notice=notices[i18n.language.split('-')[0]!];
  return notice?<div role="status" className="border-b bg-accent/60 px-4 py-2 text-xs text-accent-foreground [overflow-wrap:anywhere]" data-testid="notice-partial-translation">{notice}</div>:null;
}
