const mockCrops = [
  {
    id: 1,
    name: '苹果树',
    area: '3亩',
    plantDate: '2026年3月',
    stage: '成熟期',
    location: '东地',
    expectedYield: 4500,
    yieldUnit: '斤',
    expectedMarketTime: '2026-06-15',
    health: 85,
    days: 45,
    nextTask: '施肥',
  },
  {
    id: 2,
    name: '大豆',
    area: '1.5亩',
    plantDate: '2026年2月',
    stage: '生长期',
    location: '南坡',
    expectedYield: 900,
    yieldUnit: '斤',
    expectedMarketTime: '2026-07-10',
    health: 92,
    days: 78,
    nextTask: '病虫害检查',
  },
]

const mockTasks = [
  {
    id: 1,
    title: '苹果树清园',
    crop: '苹果树',
    time: '上午',
    priority: 'high',
    desc: '惊蛰已过，该给果树清园了',
  },
  {
    id: 2,
    title: '查看土壤湿度',
    crop: '大豆',
    time: '下午',
    priority: 'medium',
    desc: '检查灌溉系统是否正常',
  },
]

const mockWeather = {
  temp: '18°C',
  condition: '晴',
  humidity: '65%',
  wind: '微风',
  suggestion: '适合田间作业',
}

const adTemplates = [
  {
    id: 1,
    type: '朋友圈',
    title: '产地信息图文',
    content:
      '填写作物名称、产地、预计产量和上市时间后，系统会按作物档案整理发布文案。',
    tags: ['产地信息', '上市时间', '供应数量'],
    platform: 'wechat',
    engagement: 85,
  },
  {
    id: 2,
    type: '小红书',
    title: '种植过程图文',
    content:
      '结合真实田间照片、作物长势和采收安排，整理自然、可信的图文内容。',
    tags: ['田间实拍', '作物长势', '采收安排'],
    platform: 'xiaohongshu',
    engagement: 92,
  },
  {
    id: 3,
    type: '抖音口播',
    title: '产地介绍口播',
    content:
      '根据实际产地、作物、上市时间和供应数量，整理短视频口播结构。',
    tags: ['短视频', '产地介绍', '供应信息'],
    platform: 'douyin',
    engagement: 88,
  },
]

const farmProfile = {
  products: [],
  features: [],
  certification: '',
  location: '',
}

const marketOverview = {
  crops: [
    {
      id: 1,
      name: '苹果',
      currentPrice: 4.5,
      unit: '斤',
      change: -7.1,
      trend: 'down',
      prediction: '预计2天后价格下跌',
      advice: '建议尽快出售',
      marketStatus: '供大于求',
      avgPrice: 4.2,
      highPrice: 5.8,
      lowPrice: 3.6,
      weekVolume: 23500,
      monthVolume: 95600,
      userOwned: true,
      source: 'core',
    },
    {
      id: 2,
      name: '大豆',
      currentPrice: 5.8,
      unit: '斤',
      change: 3.2,
      trend: 'up',
      prediction: '未来一周持续上涨',
      advice: '可继续观望',
      marketStatus: '供不应求',
      avgPrice: 5.5,
      highPrice: 6.2,
      lowPrice: 5,
      weekVolume: 18300,
      monthVolume: 72400,
      userOwned: true,
      source: 'core',
    },
    {
      id: 3,
      name: '玉米',
      currentPrice: 2.3,
      unit: '斤',
      change: -0.8,
      trend: 'stable',
      prediction: '价格波动较小',
      advice: '择机出售',
      marketStatus: '供需平衡',
      avgPrice: 2.3,
      highPrice: 2.5,
      lowPrice: 2.1,
      weekVolume: 45600,
      monthVolume: 185000,
      userOwned: false,
      source: 'core',
    },
  ],
  nearbyMarkets: [
    { name: '烟台批发市场', distance: '2.3km', price: 4.8, trend: 'up' },
    { name: '栖霞农贸市场', distance: '5.6km', price: 4.5, trend: 'stable' },
    { name: '蓬莱收购站', distance: '8.9km', price: 4.3, trend: 'down' },
  ],
  priceAlerts: [
    {
      crop: '苹果',
      title: '价格即将跌破心理价位',
      message: '苹果价格预计明天跌至4.2元/斤，低于你的心理价位4.5元',
      action: '建议今天出售',
      urgency: 'high',
    },
    {
      crop: '大豆',
      title: '达到最佳出售时机',
      message: '大豆价格已达5.8元/斤，较本月均价上涨5.5%',
      action: '可择机出售',
      urgency: 'medium',
    },
  ],
  recommendations: [
    {
      title: '你的苹果+套种方案',
      content: '苹果树下套种大豆',
      roi: '45',
      profit: 1200,
      benefits: ['天然固氮，节约肥料成本200元/亩', '充分利用现有3亩苹果林空间', '大豆行情好，预计增收1200元'],
      tag: '高度匹配',
      difficulty: '简单',
      cycle: '3-4个月',
      matchScore: 95,
      reason: '基于你现有的3亩苹果树+1.5亩大豆经验',
    },
  ],
}

const buyerOverview = {
  buyers: [
    {
      id: 1,
      name: '烟台鲜果批发市场',
      distance: '2.3km',
      rating: 4.8,
      orders: 328,
      contact: '138****8888',
      products: [
        { name: '苹果', price: 4.8, demand: 500, unit: '斤' },
        { name: '大豆', price: 5.5, demand: 300, unit: '斤' },
      ],
      badge: '金牌',
      profit: 2850,
      netProfit: 2420,
      transport: 120,
      loss: 310,
    },
    {
      id: 2,
      name: '村口农贸市场',
      distance: '0.8km',
      rating: 4.6,
      orders: 156,
      contact: '139****6666',
      products: [
        { name: '苹果', price: 4.2, demand: 300, unit: '斤' },
        { name: '大豆', price: 5.8, demand: 200, unit: '斤' },
      ],
      badge: '银牌',
      profit: 2520,
      netProfit: 2460,
      transport: 40,
      loss: 20,
    },
  ],
  myProducts: [
    { name: '苹果', quantity: 500, unit: '斤' },
    { name: '大豆', quantity: 200, unit: '斤' },
  ],
}

module.exports = {
  mockCrops,
  mockTasks,
  mockWeather,
  adTemplates,
  farmProfile,
  marketOverview,
  buyerOverview,
}
