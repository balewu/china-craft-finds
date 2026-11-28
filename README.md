# China Craft Finds — GitHub Pages 版

把这五个文件上传到你的 GitHub 仓库**根目录**，覆盖同名文件：

- `index.html`
- `styles.css`
- `app.js`
- `supabase.sql`
- `README.md`

不要上传别的文件夹。GitHub Pages 只能跑这种纯网页。`app.js` 顶部已经填好你的 Supabase 网址和 anon / publishable key。不要把 `service_role` 密钥写进去。

## 1. 先在 Supabase 里更新数据库

1. 打开 Supabase → **SQL Editor** → **New query**。
2. 把 `supabase.sql` 整段贴进去，运行。
3. 可以重复运行。不会删除已有商品和订单。
4. 原来的「已采购 / purchased」会自动变成「已到货 / arrived」。
5. 如果最后提示某个商品有两个相同编号，先到后台把编号改成互不相同，再运行一次。

跑完 SQL 之前，商店仍能打开，但编号会暂时用旧的 SKU code。跑完并在后台改成数字编号后，顾客才能按 `4 5 7 9` 这种数字一次加入购物袋。

- 旧商品会暂时归在大类 **General** 下面，小类还是原来的分类。请到 Admin → Products 改成真正的大类和小类。
- 旧规格的「编号」会先等于原来的 SKU code。顾客是按编号下单的，所以请改成你希望他们输入的数字，例如 `4`、`17`、`1S`。

## 2. 管理员账号

如果以前已经把你的用户 id 写进 `admin_users`，不用再做。

还没有的话：

1. Supabase → **Authentication** → **Users** → **Add user**，建一个管理员邮箱和密码。
2. 复制这个用户的 UUID。
3. SQL Editor 运行（换成你的 UUID）：

```sql
insert into public.admin_users (user_id) values ('这里贴UUID');
```

## 3. 让顾客能马上注册登录

Supabase → **Authentication** → **Sign In / Providers** → **Email**。

建议先关掉 **Confirm email**，这样注册完就能登录、下单、在个人中心看订单。

如果保持开启：顾客要点邮件里的确认链接。请到 **Authentication** → **URL Configuration**，把你的 GitHub Pages 网址填进 Site URL，例如 `https://你的用户名.github.io/china-craft-finds/`。

## 4. 发布到 GitHub Pages

1. 打开原来的仓库，上传这五个文件，覆盖旧文件，Commit。
2. **Settings** → **Pages** → Deploy from branch → 分支 `main`，目录 `/ (root)` → Save。
3. 等一两分钟，打开你的 Pages 网址。

入口：

- 顶栏 **Shop**、首页 **Explore the finds**：进入单独的商店页，不是往下滚。
- 顶栏 **Before you buy**：购前须知。顶栏 **Feedback**：你选择公开的顾客评价。
- 右下角灰色 **Admin**，页脚也有一个。

## 5. 商品怎么填

Admin → Products → Add a product。

- Main category：大类，例如 `Clay tools`
- Subcategory：小类，例如 `Body molds`
- Source shop：来源店铺。顾客看不到。同一家店请写成完全一样的名字，服务费才会把它们算成一家。
- Needs a detailed check video：这款要不要详细核验视频。顾客看不到。勾上之后，购物袋里这款的每一个编号都算一个「需核验种类」。
- 每一行一个规格，用竖线隔开：

```text
编号 | SKU code | 款式名 | 美元价格 | 图片网址（可以不写）
4 | PETAL-4 | Five-petal blossom | 4.80
17 | PETAL-17 | Blush garden rose | 6.90 | https://你的图片
1S | SH01-S | Shape 01 small | 3.50
```

编号就是顾客一次输入很多个时用的。例如输入 `4 5 7 9`，会一起加入购物袋。购物车和订单里按商品名字母排序，同一个商品里按编号从小到大（1、2、6、10、17，不是 1、10、17、2）。

编辑商品时，没写进文本框的旧规格会被隐藏，不会删掉，这样老订单还能再加入购物袋。

旧商品保存一次来源店铺之前，每件没填店铺的商品会按「各自一家店」计算服务费，避免少算。请把已有商品的店铺补上。

## 5.1 服务费

购物袋里除了商品总价，会自动出现服务费。下单时由数据库再算一遍并写进订单，不采用浏览器里临时改过的数字。

每个 SKU（每个编号）算一个商品种类。

```text
人民币 = max(20,
  12 × 店铺数量
  + 2.5 × max(0, 种类数量 − 店铺数量)
  + 0.5 × min(20, 总件数 − 种类数量)
  + 8 × 需要详细核验的种类数量)
美元 = 人民币 ÷ 6.5
再向上取整到以 .00 或 .50 结尾
```

例如只有 1 个编号、1 家店、不核验：20 ÷ 6.5 ≈ 3.08，向上变成 **$3.50**。

个人中心、订单详情和管理员订单里都会看到商品小计、服务费和货款合计。邮费仍然是之后单独算的。

## 6. 有人下单时发邮件给你

用免费的 [FormSubmit](https://formsubmit.co)。不要用 ntfy，那个可能收费。

1. 还是要先在 Supabase → **Database** → **Extensions** 打开 **pg_net**。如果没开，回 SQL Editor 把 `supabase.sql` 再运行一次。
2. 网站右下角 **Admin** → **Alerts**。
3. **Your email** 填你的邮箱。**Webhook** 留空。
4. 保存，点 **Send a test**。
5. 第一次你会收到 FormSubmit 的确认信，点开里面的链接。之后新订单才会发到这个邮箱。请也看一下垃圾箱。

邮件发不出去也不会影响顾客下单。

## 7. 评价、原图、删除

- 主页和商店不显示商品描述。点 **View** 或商品名字，弹出详情，里面才有描述、编号、名字、价格和缩略图。价格显示最低价到最高价。
- 商品主图、编号缩略图、购物车和订单里的小图，点一下可以看原图。
- 顶栏 **Feedback** 是客户反馈。只有你在 Admin → **Notes** 里点了 **Share** 的评价才会出现。评价都不显示顾客名字。已公开的商品评价也会出现在该商品详情底部。
- 顾客只能给状态是 **Shipped** 的订单写评价，可以评整单，也可以评里面的每一款。
- Admin → Products 可以按大类、小类和关键字找商品，每行前面有主图。商品和订单都可以删除。删除前会弹出确认；删订单时会写明当前状态，例如 Paid。

## 8. 建议自己走一遍

用另一个邮箱注册，不要用管理员邮箱。

1. 商店里点一个商品，输入多个编号，看购物袋是否按「商品名 → 编号」排好。
2. 结账时地址顺序是：国家 / 地区、州/省、**街道**、城市、邮编。
3. 提交后应看到 “Thank you for choosing me.”，旁边可以进订单详情。
4. 个人中心能看到日期、订单号、件数、商品标价、服务费、状态。状态还是 Pending review 时可以取消，你在后台改成别的状态后就不能取消。
5. 购物袋里应同时看到商品小计和服务费。两家店、或勾了详细核验的商品，服务费会更高。
6. 后台把订单改成 **Arrived**。顾客打开订单，会要求确认地址；不确认就不继续。确认后看到邮费；你还没填就是 **Pending calculation**。
7. 你在后台填邮费，再把状态改成 **Shipped**，这时必须填快递单号。顾客的订单详情里能看到单号。
8. 顾客可以在历史订单里把某一款再加入购物袋。

首页只显示最新上传的 6 个商品。全部商品在 Shop 页，有两级分类。
