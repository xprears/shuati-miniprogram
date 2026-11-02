// 全局逻辑：题库索引 + 状态存储加载
const store = require('./utils/store.js');

App({
  onLaunch() {
    store.init();
    store.reconcileBank();   // 题库换过就清掉旧库遗留记录；首次启动只做对账不删数据
  },
  globalData: {}
});
