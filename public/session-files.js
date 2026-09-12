const SESSION_FILE_PATH = /^\/api\/session-files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function sessionFileUrl(fileUrl) {
    const url = new URL(fileUrl, window.location.origin);
    if (url.origin !== window.location.origin || !SESSION_FILE_PATH.test(url.pathname)) {
        throw new Error("文件链接无效或不是本站会话文件");
    }
    return url;
}

export async function downloadSessionFile(fileUrl, { filename = "session-file", onError } = {}) {
    try {
        const url = sessionFileUrl(fileUrl);
        const token = localStorage.getItem("WQT_AUTH_TOKEN") || "";
        if (!token) throw new Error("请先登录后下载文件");
        const response = await fetch(url.href, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`文件下载失败（${response.status}）`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        return true;
    } catch (error) {
        if (typeof onError === "function") onError(error);
        else alert(error.message || "文件下载失败");
        return false;
    }
}
