// 全局逻辑：题库索引 + 状态存储加载
const store = require('./utils/store.js');

App({
  onLaunch() {
    store.init();
  },
  globalData: {}
});
