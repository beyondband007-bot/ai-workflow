(() => {
  const workflowNames = {
    "WF-001": "性价比文生图",
    "WF-002": "高质量文生图",
    "WF-003": "跨境电商图生图",
  };

  function getName(workflowCode, fallback = "") {
    const code = String(workflowCode || "").trim();
    return workflowNames[code] || fallback || code || "-";
  }

  window.ClientPortalWorkflowLabels = {
    getName,
    names: { ...workflowNames },
  };
})();
