import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'ar', label: 'العربية', rtl: true },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

const KEYS = [
  'home', 'market', 'rentals', 'wallet', 'profile', 'referrals', 'help', 'notifications', 'kyc',
  'deposit', 'withdraw', 'rent', 'invite', 'signIn', 'signUp', 'signOut', 'totalBalance',
  'activeRentals', 'noRentals', 'browseMarket', 'search', 'perMinute', 'perHour', 'perDay',
  'available', 'confirm', 'cancel', 'save', 'history', 'transactions', 'language', 'theme',
  'security', 'sessions', 'apiKeys', 'preferences', 'tickets', 'newTicket', 'markAllRead',
  'signInPrompt', 'extend', 'stop', 'autoRenew', 'paused', 'active', 'retry', 'loadError',
  'properties', 'machines', 'all', 'verifyNow', 'kycBanner', 'risk',
] as const;

type Dict = Record<(typeof KEYS)[number], string>;
const row = (vals: string[]): Dict => Object.fromEntries(KEYS.map((k, i) => [k, vals[i] ?? k])) as Dict;

const en = row(['Home','Market','Rentals','Wallet','Profile','Referrals','Help','Notifications','Verification','Deposit','Withdraw','Rent','Invite','Sign in','Create account','Sign out','Total balance','Active rentals','No rentals running','Browse market','Search','per minute','per hour','per day','available','Confirm','Cancel','Save','History','Transactions','Language','Theme','Security','Sessions','API keys','Preferences','Tickets','New ticket','Mark all read','Sign in to fund your wallet and start renting.','Extend','Stop','Auto-renew','Paused','Active','Retry','We could not load this.','Properties','Machines','All','Verify now','Verification has been requested for your account.','Rental profit follows the published term and early-stop settlement rules. Crypto transfers carry risk.']);
const es = row(['Inicio','Mercado','Alquileres','Billetera','Perfil','Referidos','Ayuda','Notificaciones','Verificación','Depositar','Retirar','Alquilar','Invitar','Iniciar sesión','Crear cuenta','Cerrar sesión','Saldo total','Alquileres activos','Sin alquileres activos','Explorar mercado','Buscar','por minuto','por hora','por día','disponibles','Confirmar','Cancelar','Guardar','Historial','Transacciones','Idioma','Tema','Seguridad','Sesiones','Claves API','Preferencias','Tickets','Nuevo ticket','Marcar todo leído','Inicia sesión para fondear tu billetera y alquilar.','Extender','Detener','Renovación automática','Pausado','Activo','Reintentar','No pudimos cargar esto.','Propiedades','Máquinas','Todo','Verificar ahora','Se solicitó la verificación de tu cuenta.','Los alquileres y las criptomonedas conllevan riesgo. Los rendimientos no están garantizados.']);
const fr = row(['Accueil','Marché','Locations','Portefeuille','Profil','Parrainage','Aide','Notifications','Vérification','Déposer','Retirer','Louer','Inviter','Se connecter','Créer un compte','Se déconnecter','Solde total','Locations actives','Aucune location en cours','Explorer le marché','Rechercher','par minute','par heure','par jour','disponibles','Confirmer','Annuler','Enregistrer','Historique','Transactions','Langue','Thème','Sécurité','Sessions','Clés API','Préférences','Tickets','Nouveau ticket','Tout marquer lu','Connectez-vous pour alimenter votre portefeuille et louer.','Prolonger','Arrêter','Renouvellement auto','En pause','Active','Réessayer','Chargement impossible.','Biens','Machines','Tout','Vérifier','Une vérification a été demandée pour votre compte.','Les locations et les cryptos comportent des risques. Aucun rendement garanti.']);
const pt = row(['Início','Mercado','Aluguéis','Carteira','Perfil','Indicações','Ajuda','Notificações','Verificação','Depositar','Sacar','Alugar','Convidar','Entrar','Criar conta','Sair','Saldo total','Aluguéis ativos','Nenhum aluguel ativo','Explorar mercado','Buscar','por minuto','por hora','por dia','disponíveis','Confirmar','Cancelar','Salvar','Histórico','Transações','Idioma','Tema','Segurança','Sessões','Chaves API','Preferências','Tickets','Novo ticket','Marcar tudo como lido','Entre para abastecer sua carteira e alugar.','Estender','Parar','Renovação automática','Pausado','Ativo','Tentar novamente','Não foi possível carregar.','Imóveis','Máquinas','Tudo','Verificar agora','Uma verificação foi solicitada para sua conta.','Aluguéis e cripto envolvem risco. Retornos não são garantidos.']);
const ar = row(['الرئيسية','السوق','الإيجارات','المحفظة','الملف','الإحالات','المساعدة','الإشعارات','التحقق','إيداع','سحب','استئجار','دعوة','تسجيل الدخول','إنشاء حساب','تسجيل الخروج','إجمالي الرصيد','الإيجارات النشطة','لا توجد إيجارات','تصفح السوق','بحث','لكل دقيقة','لكل ساعة','لكل يوم','متاح','تأكيد','إلغاء','حفظ','السجل','المعاملات','اللغة','المظهر','الأمان','الجلسات','مفاتيح API','التفضيلات','التذاكر','تذكرة جديدة','تعليم الكل كمقروء','سجّل الدخول لتمويل محفظتك والبدء بالاستئجار.','تمديد','إيقاف','تجديد تلقائي','متوقف مؤقتًا','نشط','إعادة المحاولة','تعذر التحميل.','العقارات','الآلات','الكل','تحقق الآن','تم طلب التحقق من حسابك.','الإيجارات والعملات المشفرة تنطوي على مخاطر. العوائد غير مضمونة.']);
const sw = row(['Nyumbani','Soko','Ukodishaji','Pochi','Wasifu','Rufaa','Msaada','Arifa','Uthibitisho','Weka','Toa','Kodisha','Alika','Ingia','Fungua akaunti','Toka','Salio jumla','Ukodishaji hai','Hakuna ukodishaji','Vinjari soko','Tafuta','kwa dakika','kwa saa','kwa siku','zinapatikana','Thibitisha','Ghairi','Hifadhi','Historia','Miamala','Lugha','Mandhari','Usalama','Vipindi','Funguo za API','Mapendeleo','Tiketi','Tiketi mpya','Weka zote zimesomwa','Ingia ili kuweka pesa na kuanza kukodisha.','Ongeza muda','Simamisha','Jisasishe','Imesimamishwa','Hai','Jaribu tena','Imeshindwa kupakia.','Mali','Mashine','Zote','Thibitisha sasa','Uthibitisho umeombwa kwa akaunti yako.','Ukodishaji na crypto vina hatari. Faida hazihakikishwi.']);
const zh = row(['首页','市场','租赁','钱包','我的','推荐','帮助','通知','身份验证','充值','提现','租用','邀请','登录','注册','退出','总余额','进行中的租赁','暂无租赁','浏览市场','搜索','每分钟','每小时','每天','可用','确认','取消','保存','历史','交易记录','语言','主题','安全','会话','API 密钥','偏好设置','工单','新建工单','全部已读','登录后即可充值并开始租用。','延长','停止','自动续租','已暂停','进行中','重试','加载失败。','房产','机器','全部','立即验证','您的账户已被要求进行身份验证。','租赁与加密资产存在风险，收益不作保证。']);
const hi = row(['होम','बाज़ार','किराये','वॉलेट','प्रोफ़ाइल','रेफ़रल','सहायता','सूचनाएँ','सत्यापन','जमा','निकासी','किराये पर लें','आमंत्रित करें','साइन इन','खाता बनाएँ','साइन आउट','कुल शेष','सक्रिय किराये','कोई सक्रिय किराया नहीं','बाज़ार देखें','खोजें','प्रति मिनट','प्रति घंटा','प्रति दिन','उपलब्ध','पुष्टि करें','रद्द करें','सहेजें','इतिहास','लेन-देन','भाषा','थीम','सुरक्षा','सत्र','API कुंजियाँ','प्राथमिकताएँ','टिकट','नया टिकट','सभी पढ़े','वॉलेट भरने और किराये पर लेने के लिए साइन इन करें।','बढ़ाएँ','रोकें','स्वतः नवीनीकरण','रुका हुआ','सक्रिय','पुनः प्रयास','लोड नहीं हो सका।','संपत्तियाँ','मशीनें','सभी','अभी सत्यापित करें','आपके खाते के लिए सत्यापन का अनुरोध किया गया है।','किराये और क्रिप्टो में जोखिम है। रिटर्न की गारंटी नहीं है।']);

const detect = () => {
  const saved = localStorage.getItem('vexa-lang');
  if (saved) return saved;
  const nav = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
};

i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries({ en, es, fr, pt, ar, sw, zh, hi }).map(([k, v]) => [k, { translation: v }]),
  ),
  lng: detect(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function applyLanguage(code: string) {
  const lang = LANGUAGES.some((l) => l.code === code) ? code : 'en';
  i18n.changeLanguage(lang);
  localStorage.setItem('vexa-lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGUAGES.find((l) => l.code === lang && 'rtl' in l) ? 'rtl' : 'ltr';
}
applyLanguage(i18n.language);

export default i18n;
