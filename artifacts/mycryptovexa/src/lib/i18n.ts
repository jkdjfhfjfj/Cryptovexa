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
  'capitalRequired', 'estimatedProfit', 'totalAtMaturity', 'lockedUntilMaturity', 'rentalTermsAck',
  'profitRateLabel', 'termProfit', 'paidProfit', 'earlyStopProration',
] as const;

type Dict = Record<(typeof KEYS)[number], string>;
const row = (vals: string[]): Dict => Object.fromEntries(KEYS.map((k, i) => [k, vals[i] ?? k])) as Dict;

const en = row(['Home','Market','Rentals','Wallet','Profile','Referrals','Help','Notifications','Verification','Deposit','Withdraw','Rent','Invite','Sign in','Create account','Sign out','Total balance','Active rentals','No rentals running','Browse market','Search','per minute','per hour','per day','available','Confirm','Cancel','Save','History','Transactions','Language','Theme','Security','Sessions','API keys','Preferences','Tickets','New ticket','Mark all read','Sign in to fund your wallet and start renting.','Extend','Stop','Auto-renew','Paused','Active','Retry','We could not load this.','Properties','Machines','All','Verify now','Verification has been requested for your account.','Rental profit follows the published term and early-stop settlement rules. Crypto transfers carry risk.','Required capital','Estimated profit','Total released at maturity','Principal stays locked for the term. At maturity it is released with scheduled profit unless auto-renew starts another term.','I understand and accept the capital, profit schedule, maturity settlement, and early-stop rules.','Profit rate','Term profit','Profit paid','Early stop releases principal and prorated profit.']);
const es = row(['Inicio','Mercado','Alquileres','Billetera','Perfil','Referidos','Ayuda','Notificaciones','Verificación','Depositar','Retirar','Alquilar','Invitar','Iniciar sesión','Crear cuenta','Cerrar sesión','Saldo total','Alquileres activos','Sin alquileres activos','Explorar mercado','Buscar','por minuto','por hora','por día','disponibles','Confirmar','Cancelar','Guardar','Historial','Transacciones','Idioma','Tema','Seguridad','Sesiones','Claves API','Preferencias','Tickets','Nuevo ticket','Marcar todo leído','Inicia sesión para fondear tu billetera y alquilar.','Extender','Detener','Renovación automática','Pausado','Activo','Reintentar','No pudimos cargar esto.','Propiedades','Máquinas','Todo','Verificar ahora','Se solicitó la verificación de tu cuenta.','Los alquileres y las criptomonedas conllevan riesgos. Revisa los términos y las reglas de liquidación.','Capital requerido','Ganancia estimada','Total liberado al vencimiento','El capital queda bloqueado durante el plazo; al vencer se libera con la ganancia programada, salvo que la renovación automática inicie otro plazo.','Entiendo y acepto el capital, el calendario de ganancias, la liquidación y las reglas de salida anticipada.','Tasa de ganancia','Ganancia del plazo','Ganancia pagada','La salida anticipada libera el capital y paga la ganancia prorrateada.']);
const fr = row(['Accueil','Marché','Locations','Portefeuille','Profil','Parrainage','Aide','Notifications','Vérification','Déposer','Retirer','Louer','Inviter','Se connecter','Créer un compte','Se déconnecter','Solde total','Locations actives','Aucune location en cours','Explorer le marché','Rechercher','par minute','par heure','par jour','disponibles','Confirmer','Annuler','Enregistrer','Historique','Transactions','Langue','Thème','Sécurité','Sessions','Clés API','Préférences','Tickets','Nouveau ticket','Tout marquer lu','Connectez-vous pour alimenter votre portefeuille et louer.','Prolonger','Arrêter','Renouvellement auto','En pause','Active','Réessayer','Chargement impossible.','Biens','Machines','Tout','Vérifier','Une vérification a été demandée pour votre compte.','Les locations et les cryptomonnaies comportent des risques. Consultez les conditions et les règles de règlement.','Capital requis','Profit estimé','Total libéré à échéance','Le capital reste bloqué pendant le terme; à échéance, il est libéré avec le profit prévu, sauf si le renouvellement automatique démarre un nouveau terme.','Je comprends et j’accepte le capital, le calendrier de profit, le règlement à échéance et les règles d’arrêt anticipé.','Taux de profit','Profit du terme','Profit versé','Un arrêt anticipé libère le capital et verse le profit au prorata.']);
const pt = row(['Início','Mercado','Aluguéis','Carteira','Perfil','Indicações','Ajuda','Notificações','Verificação','Depositar','Sacar','Alugar','Convidar','Entrar','Criar conta','Sair','Saldo total','Aluguéis ativos','Nenhum aluguel ativo','Explorar mercado','Buscar','por minuto','por hora','por dia','disponíveis','Confirmar','Cancelar','Salvar','Histórico','Transações','Idioma','Tema','Segurança','Sessões','Chaves API','Preferências','Tickets','Novo ticket','Marcar tudo como lido','Entre para abastecer sua carteira e alugar.','Estender','Parar','Renovação automática','Pausado','Ativo','Tentar novamente','Não foi possível carregar.','Imóveis','Máquinas','Tudo','Verificar agora','Uma verificação foi solicitada para sua conta.','Aluguéis e criptomoedas envolvem riscos. Consulte os termos e as regras de liquidação.','Capital necessário','Lucro estimado','Total liberado no vencimento','O capital fica bloqueado durante o prazo; no vencimento é liberado com o lucro previsto, a menos que a renovação automática inicie outro prazo.','Entendo e aceito o capital, o cronograma de lucro, a liquidação e as regras de encerramento antecipado.','Taxa de lucro','Lucro do prazo','Lucro pago','O encerramento antecipado libera o capital e paga o lucro proporcional.']);
const ar = row(['الرئيسية','السوق','الإيجارات','المحفظة','الملف','الإحالات','المساعدة','الإشعارات','التحقق','إيداع','سحب','استئجار','دعوة','تسجيل الدخول','إنشاء حساب','تسجيل الخروج','إجمالي الرصيد','الإيجارات النشطة','لا توجد إيجارات','تصفح السوق','بحث','لكل دقيقة','لكل ساعة','لكل يوم','متاح','تأكيد','إلغاء','حفظ','السجل','المعاملات','اللغة','المظهر','الأمان','الجلسات','مفاتيح API','التفضيلات','التذاكر','تذكرة جديدة','تعليم الكل كمقروء','سجّل الدخول لتمويل محفظتك والبدء بالاستئجار.','تمديد','إيقاف','تجديد تلقائي','متوقف مؤقتًا','نشط','إعادة المحاولة','تعذر التحميل.','العقارات','الآلات','الكل','تحقق الآن','تم طلب التحقق من حسابك.','تنطوي الإيجارات وتحويلات العملات المشفرة على مخاطر. راجع الشروط وقواعد التسوية.']);
const sw = row(['Nyumbani','Soko','Ukodishaji','Pochi','Wasifu','Rufaa','Msaada','Arifa','Uthibitisho','Weka','Toa','Kodisha','Alika','Ingia','Fungua akaunti','Toka','Salio jumla','Ukodishaji hai','Hakuna ukodishaji','Vinjari soko','Tafuta','kwa dakika','kwa saa','kwa siku','zinapatikana','Thibitisha','Ghairi','Hifadhi','Historia','Miamala','Lugha','Mandhari','Usalama','Vipindi','Funguo za API','Mapendeleo','Tiketi','Tiketi mpya','Weka zote zimesomwa','Ingia ili kuweka pesa na kuanza kukodisha.','Ongeza muda','Simamisha','Jisasishe','Imesimamishwa','Hai','Jaribu tena','Imeshindwa kupakia.','Mali','Mashine','Zote','Thibitisha sasa','Uthibitisho umeombwa kwa akaunti yako.','Ukodishaji na uhamishaji wa crypto una hatari. Kagua masharti na sheria za malipo.']);
const zh = row(['首页','市场','租赁','钱包','我的','推荐','帮助','通知','身份验证','充值','提现','租用','邀请','登录','注册','退出','总余额','进行中的租赁','暂无租赁','浏览市场','搜索','每分钟','每小时','每天','可用','确认','取消','保存','历史','交易记录','语言','主题','安全','会话','API 密钥','偏好设置','工单','新建工单','全部已读','登录后即可充值并开始租用。','延长','停止','自动续租','已暂停','进行中','重试','加载失败。','房产','机器','全部','立即验证','您的账户已被要求进行身份验证。','租赁和加密资产转账存在风险。请查看条款和结算规则。']);
const hi = row(['होम','बाज़ार','किराये','वॉलेट','प्रोफ़ाइल','रेफ़रल','सहायता','सूचनाएँ','सत्यापन','जमा','निकासी','किराये पर लें','आमंत्रित करें','साइन इन','खाता बनाएँ','साइन आउट','कुल शेष','सक्रिय किराये','कोई सक्रिय किराया नहीं','बाज़ार देखें','खोजें','प्रति मिनट','प्रति घंटा','प्रति दिन','उपलब्ध','पुष्टि करें','रद्द करें','सहेजें','इतिहास','लेन-देन','भाषा','थीम','सुरक्षा','सत्र','API कुंजियाँ','प्राथमिकताएँ','टिकट','नया टिकट','सभी पढ़े','वॉलेट भरने और किराये पर लेने के लिए साइन इन करें।','बढ़ाएँ','रोकें','स्वतः नवीनीकरण','रुका हुआ','सक्रिय','पुनः प्रयास','लोड नहीं हो सका।','संपत्तियाँ','मशीनें','सभी','अभी सत्यापित करें','आपके खाते के लिए सत्यापन का अनुरोध किया गया है।','किराये और क्रिप्टो ट्रांसफ़र में जोखिम है। शर्तें और निपटान नियम देखें।']);

Object.assign(ar, {
  capitalRequired:'رأس المال المطلوب', estimatedProfit:'الربح التقديري', totalAtMaturity:'إجمالي المبلغ المفرج عند الاستحقاق',
  lockedUntilMaturity:'يبقى رأس المال مقفلاً خلال المدة. عند الاستحقاق يُفرج عنه مع الربح المجدول، ما لم يبدأ التجديد التلقائي مدة جديدة.',
  rentalTermsAck:'أفهم وأوافق على رأس المال وجدول الأرباح والتسوية عند الاستحقاق وقواعد الإيقاف المبكر.',
  profitRateLabel:'معدل الربح', termProfit:'ربح المدة', paidProfit:'الربح المدفوع',
  earlyStopProration:'يُفرج عن رأس المال ويُدفع الربح بنسبة المدة عند الإيقاف المبكر.',
});
Object.assign(sw, {
  capitalRequired:'Mtaji unaohitajika', estimatedProfit:'Faida inayokadiriwa', totalAtMaturity:'Jumla itakayotolewa ukomavu ukifika',
  lockedUntilMaturity:'Mtaji hubaki umefungwa wakati wa muda. Ukomavu ukifika hutolewa pamoja na faida iliyopangwa, isipokuwa sasisho la kiotomatiki lianzishe muda mwingine.',
  rentalTermsAck:'Ninaelewa na kukubali mtaji, ratiba ya faida, malipo wakati wa ukomavu na masharti ya kusitisha mapema.',
  profitRateLabel:'Kiwango cha faida', termProfit:'Faida ya muda', paidProfit:'Faida iliyolipwa',
  earlyStopProration:'Kusitisha mapema hufungua mtaji na kulipa faida kulingana na muda.',
});
Object.assign(zh, {
  capitalRequired:'所需本金', estimatedProfit:'预计利润', totalAtMaturity:'到期释放总额',
  lockedUntilMaturity:'本金在期限内保持锁定。到期时将与计划利润一起释放，除非自动续租开始新的期限。',
  rentalTermsAck:'我理解并接受所需本金、利润计划、到期结算和提前停止规则。',
  profitRateLabel:'利润率', termProfit:'期限利润', paidProfit:'已支付利润',
  earlyStopProration:'提前停止时释放本金，并按时间比例结算利润。',
});
Object.assign(hi, {
  capitalRequired:'आवश्यक पूँजी', estimatedProfit:'अनुमानित लाभ', totalAtMaturity:'परिपक्वता पर जारी कुल राशि',
  lockedUntilMaturity:'पूँजी अवधि के दौरान लॉक रहेगी। परिपक्वता पर यह निर्धारित लाभ के साथ जारी होगी, जब तक कि ऑटो-रिन्यू नया समय शुरू न करे।',
  rentalTermsAck:'मैं आवश्यक पूँजी, लाभ कार्यक्रम, परिपक्वता निपटान और जल्दी रोकने के नियम समझता/समझती हूँ और स्वीकार करता/करती हूँ।',
  profitRateLabel:'लाभ दर', termProfit:'अवधि का लाभ', paidProfit:'भुगतान किया गया लाभ',
  earlyStopProration:'जल्दी रोकने पर पूँजी जारी होगी और समय के अनुपात में लाभ मिलेगा।',
});

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
