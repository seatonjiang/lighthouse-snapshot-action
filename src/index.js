let core;
const tencentcloud = require("tencentcloud-sdk-nodejs-lighthouse");

const LighthouseClient = tencentcloud.lighthouse.v20200324.Client;

function maskId(id) {
  if (typeof id !== "string" || !id.includes("-")) {
    return id;
  }
  const parts = id.split("-");
  const prefix = parts[0];
  const uniquePart = parts[1];
  if (uniquePart.length <= 5) {
    return `${prefix}-${"*".repeat(uniquePart.length)}`;
  }
  const visibleHead = uniquePart.substring(0, 2);
  const visibleTail = uniquePart.substring(uniquePart.length - 2);
  const maskedMiddle = "*".repeat(uniquePart.length - 4);
  return `${prefix}-${visibleHead}${maskedMiddle}${visibleTail}`;
}
async function handleSnapshot(client, instanceId, snapshotMode) {
  const maskedInstanceId = maskId(instanceId);
  core.info(`\n🔄 [${maskedInstanceId}] 实例快照创建流程`);

  core.info(`  ├─ 📋 正在获取快照列表`);
  const { SnapshotSet, TotalCount } = await client.DescribeSnapshots({
    Filters: [
      {
        Name: "instance-id",
        Values: [instanceId],
      },
    ],
  });

  if (TotalCount < 2) {
    core.info("  ├─ 📸 快照数量未达上限，正在创建新快照");
    const { SnapshotId } = await client.CreateInstanceSnapshot({
      InstanceId: instanceId,
    });
    core.info(`  └─ 🎉 快照创建成功，快照：${maskId(SnapshotId)}`);
  } else {
    let snapshotToDelete = null;
    if (snapshotMode === "loop") {
      const sortedSnapshots = SnapshotSet.sort(
        (a, b) => new Date(a.CreatedTime) - new Date(b.CreatedTime)
      );
      snapshotToDelete = sortedSnapshots[0];
    } else if (snapshotMode === "fixed") {
      const sortedSnapshots = SnapshotSet.sort(
        (a, b) => new Date(b.CreatedTime) - new Date(a.CreatedTime)
      );
      snapshotToDelete = sortedSnapshots[0];
    }

    if (snapshotToDelete && snapshotToDelete.SnapshotState === "NORMAL") {
      core.info(`  ├─ 🗑️ 正在删除旧快照`);
      await client.DeleteSnapshots({
        SnapshotIds: [snapshotToDelete.SnapshotId],
      });
      core.info("  ├─ 📸 正在创建新快照");
      const { SnapshotId } = await client.CreateInstanceSnapshot({
        InstanceId: instanceId,
      });
      core.info(`  └─ 🎉 快照创建成功，快照：${maskId(SnapshotId)}`);
    } else {
      core.warning(
        "  └─ ⚠️ 没有处于「NORMAL」状态的快照可供删除，或快照模式无效。"
      );
    }
  }
}

async function main() {
  try {
    core = await import("@actions/core");

    const secretId = core.getInput("secret_id", { required: true });
    const secretKey = core.getInput("secret_key", { required: true });
    const regionInstance = core.getInput("region_instance", { required: true });
    const snapshotMode = core.getInput("snapshot_mode", { required: true });

    const instances = regionInstance.split(",").filter((i) => i.trim() !== "");

    for (const instance of instances) {
      const [region, instanceId] = instance.split(":");

      if (!region || !instanceId) {
        throw new Error(`无效的 region_instance 格式`);
      }

      if (!region.startsWith("ap-")) {
        throw new Error(`无效的地域`);
      }

      if (!instanceId.startsWith("lhins-")) {
        throw new Error(`无效的实例 ID`);
      }

      const client = new LighthouseClient({
        credential: {
          secretId,
          secretKey,
        },
        region,
        profile: {
          httpProfile: {
            endpoint: "lighthouse.tencentcloudapi.com",
          },
        },
      });

      await handleSnapshot(client, instanceId, snapshotMode);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
