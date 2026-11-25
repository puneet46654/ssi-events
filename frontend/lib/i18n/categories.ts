import type { EventCategory, EventCategoryType } from '../event-categories';
import type { Locale } from './types';

/*
 * Translations of the category copy in lib/event-categories.ts (English stays there).
 * Brand names (SMRSC, SSi Mantra, SSi MantraM, SS Innovations, CDSCO) are kept as is.
 */
type CategoryText = {
  name?: string; cardLabel?: string; heading?: string; description: string; imageAlt: string;
  title?: string; listHeading: string; empty: string; intro: string[];
  steps?: { heading: string; items: string[] }; comingSoon?: string; pastHeading?: string;
};

const TEXT: Record<Exclude<Locale, 'en'>, Record<EventCategoryType, CategoryText>> = {
  zh: {
    conference: {
      description: '由 SS Innovations 主办的全球 SSI 多专科机器人手术大会。',
      imageAlt: 'SMRSC 会场中的与会代表',
      listHeading: '报名',
      empty: '',
      intro: ['使用 SSi Mantra 开展手术的外科医生将分享各专科的临床成果，并设有远程手术与培训专题。SSi MantraM 于古尔冈举办的 SMRSC 2025 上首次亮相。'],
      comingSoon: '报名在大会官网进行。报名开放后，链接将在此处添加。',
    },
    mantram: {
      description: '印度首个移动式远程机器人手术单元，将 SSi Mantra 3 带到您的医院。',
      imageAlt: '停放中并展开遮阳篷的 SSi MantraM 移动单元',
      listHeading: '即将开放的参观',
      empty: '目前没有开放报名的参观。',
      intro: ['SSi MantraM 将 SSi Mantra 3 系统带到医院，让外科医生和手术团队在自己的执业地点上手体验；其联网能力支持远程手术与远程指导，SSi Mantra 已获印度 CDSCO 批准用于这些用途。'],
      steps: {
        heading: '参观流程',
        items: [
          '预约时段。您的二维码门票会显示在屏幕上并通过邮件发送。',
          '请在时段开始前最多 15 分钟到移动单元签到。',
          '我们的临床团队会为您讲解系统，随后由您亲自操作控制台。',
        ],
      },
    },
    event: {
      name: '继续医学教育 / 工作坊', cardLabel: '继续医学教育 / 工作坊', heading: '继续医学教育与工作坊', title: '继续医学教育与工作坊',
      description: '面向外科医生和手术团队的 SSi Mantra 系统化机器人手术培训。',
      imageAlt: 'SSI Mantra 训练模拟器正在显示模拟手术',
      listHeading: '即将开展的课程',
      empty: '目前没有开放报名的课程。',
      intro: ['面向外科医生和手术团队的 SSi Mantra 实操培训：3D 4K 视野下的控制台操作技能、床旁机械臂车的摆位与对接，以及由使用该系统开展相关手术的外科医生主讲的专科课程。'],
    },
    participation: {
      name: '会议', cardLabel: '会议', heading: '会议', title: '会议',
      description: '在国内外外科学术大会上与我们的团队见面，现场了解 SSi Mantra。',
      imageAlt: '',
      listHeading: '进行中及即将举行',
      empty: '暂无即将举行的会议。',
      intro: ['欢迎莅临我们的展位，现场观看 SSi Mantra 运行、亲自操作控制台并与我们的临床团队交流。每条信息都列出日期、场地和展位，并附有大会官网链接及我们在活动中的相关动态。'],
      pastHeading: '往届会议',
    },
  },
  ko: {
    conference: {
      description: 'SS Innovations가 주최하는 글로벌 SSI 다학제 로봇 수술 학회입니다.',
      imageAlt: 'SMRSC 세션에 참석한 청중',
      listHeading: '등록',
      empty: '',
      intro: ['SSi Mantra로 수술하는 외과의들이 여러 진료과의 임상 성과를 발표하며, 원격 수술과 교육 세션도 함께 진행됩니다. SSi MantraM은 구르가온에서 열린 SMRSC 2025에서 처음 공개되었습니다.'],
      comingSoon: '등록은 학회 웹사이트에서 진행됩니다. 등록이 시작되면 이곳에 링크가 추가됩니다.',
    },
    mantram: {
      description: '인도 최초의 이동형 원격 로봇 수술 유닛으로, SSi Mantra 3를 병원으로 직접 찾아갑니다.',
      imageAlt: '차양을 펼치고 주차된 SSi MantraM 이동 유닛',
      listHeading: '예정된 방문',
      empty: '현재 등록 가능한 방문이 없습니다.',
      intro: ['SSi MantraM은 SSi Mantra 3 시스템을 병원으로 가져가 외과의와 수술팀이 근무지에서 직접 경험할 수 있게 하며, 통신 기능을 통해 원격 수술과 원격 프록터링을 지원합니다. SSi Mantra는 이 용도로 인도 CDSCO의 승인을 받았습니다.'],
      steps: {
        heading: '방문 안내',
        items: [
          '시간대를 예약하세요. QR 티켓이 화면에 표시되고 이메일로도 발송됩니다.',
          '예약 시간 15분 전부터 유닛에서 체크인할 수 있습니다.',
          '임상팀이 시스템을 안내한 뒤 직접 콘솔을 조작해 보실 수 있습니다.',
        ],
      },
    },
    event: {
      name: 'CME / 워크숍', cardLabel: 'CME / 워크숍', heading: 'CME 및 워크숍', title: 'CME 및 워크숍',
      description: '외과의와 수술팀을 위한 SSi Mantra 체계적 로봇 수술 교육입니다.',
      imageAlt: '모의 수술을 보여 주는 SSI Mantra 트레이닝 시뮬레이터',
      listHeading: '예정된 프로그램',
      empty: '현재 등록 가능한 프로그램이 없습니다.',
      intro: ['외과의와 수술팀을 위한 SSi Mantra 실습 교육: 3D 4K 영상 기반 콘솔 조작, 침상 옆 로봇 암 카트 배치 및 도킹, 그리고 이 시스템으로 해당 수술을 시행하는 외과의가 진행하는 전문 분야 세션.'],
    },
    participation: {
      name: '학회', cardLabel: '학회', heading: '학회', title: '학회',
      description: '국내외 외과 학회에서 저희 팀을 만나 SSi Mantra를 직접 확인해 보세요.',
      imageAlt: '',
      listHeading: '진행 중 및 예정',
      empty: '예정된 학회가 없습니다.',
      intro: ['부스에 방문해 SSi Mantra의 작동 모습을 보고, 콘솔에 직접 앉아 보며 임상팀과 이야기를 나눠 보세요. 각 항목에는 일정, 장소, 부스 정보와 함께 학회 웹사이트 및 행사 관련 게시물 링크가 있습니다.'],
      pastHeading: '지난 학회',
    },
  },
  ja: {
    conference: {
      description: 'SS Innovations が主催する、SSI グローバル多領域ロボット手術学会です。',
      imageAlt: 'SMRSC のセッション会場の参加者',
      listHeading: '参加登録',
      empty: '',
      intro: ['SSi Mantra で手術を行う外科医が各領域の臨床成果を発表し、遠隔手術やトレーニングのセッションも行われます。SSi MantraM はグルガオンで開催された SMRSC 2025 で初公開されました。'],
      comingSoon: '参加登録は学会の公式サイトで行います。登録開始後、こちらにリンクを掲載します。',
    },
    mantram: {
      description: 'インド初の移動式遠隔ロボット手術ユニット。SSi Mantra 3 を貴院へお届けします。',
      imageAlt: 'オーニングを広げて停車している SSi MantraM 移動ユニット',
      listHeading: '今後の訪問予定',
      empty: '現在、受付中の訪問はありません。',
      intro: ['SSi MantraM は SSi Mantra 3 システムを病院へお届けし、外科医と手術チームが普段の現場で体験できるようにします。通信機能により遠隔手術と遠隔指導（テレプロクタリング）に対応しており、SSi Mantra はこれらの用途でインド CDSCO の承認を受けています。'],
      steps: {
        heading: '体験の流れ',
        items: [
          '時間枠を予約します。QR チケットは画面に表示され、メールでも届きます。',
          '予約時間の 15 分前からユニットでチェックインできます。',
          '臨床チームがシステムをご案内した後、実際にコンソールを操作していただけます。',
        ],
      },
    },
    event: {
      name: 'CME / ワークショップ', cardLabel: 'CME / ワークショップ', heading: 'CME・ワークショップ', title: 'CME・ワークショップ',
      description: '外科医と手術チームのための、SSi Mantra による体系的なロボット手術トレーニングです。',
      imageAlt: '模擬手術を表示している SSI Mantra トレーニングシミュレーター',
      listHeading: '今後のプログラム',
      empty: '現在、受付中のプログラムはありません。',
      intro: ['外科医と手術チーム向けの SSi Mantra ハンズオントレーニング：3D 4K 映像でのコンソール操作、ベッドサイドでのアームカートの配置とドッキング、そしてこのシステムで実際に手術を行う外科医による領域別セッション。'],
    },
    participation: {
      name: '学会', cardLabel: '学会', heading: '学会', title: '学会',
      description: '国内外の外科系学会で私たちのチームに会い、SSi Mantra をご覧ください。',
      imageAlt: '',
      listHeading: '開催中・今後の予定',
      empty: '今後予定されている学会はありません。',
      intro: ['ブースで SSi Mantra の動作をご覧いただき、コンソールに座って臨床チームと話してみてください。各掲載には日程、会場、ブース番号のほか、学会公式サイトやイベントでの投稿へのリンクがあります。'],
      pastHeading: '過去の学会',
    },
  },
};

/** The category with its copy in the chosen language (English is the source data itself). */
export function localizeCategory(category: EventCategory, locale: Locale): EventCategory {
  if (locale === 'en') return category;
  const tx = TEXT[locale][category.type];
  return {
    ...category,
    name: tx.name ?? category.name,
    cardLabel: tx.cardLabel ?? category.cardLabel,
    heading: tx.heading ?? category.heading,
    description: tx.description,
    imageAlt: tx.imageAlt,
    page: {
      ...category.page,
      title: tx.title ?? category.page.title,
      listHeading: tx.listHeading,
      empty: tx.empty,
      intro: tx.intro,
      steps: category.page.steps && tx.steps ? tx.steps : category.page.steps,
    },
    external: category.external && { ...category.external, comingSoon: tx.comingSoon ?? category.external.comingSoon },
    archive: category.archive && { pastHeading: tx.pastHeading ?? category.archive.pastHeading },
  };
}
