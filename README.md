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
- 顶栏和首页的 **Before you buy**：购前须知。
- 右下角灰色 **Admin**，页脚也有一个。

## 5. 商品怎么填

Admin → Products → Add a product。

- Main category：大类，例如 `Clay tools`
- Subcategory：小类，例如 `Body molds`
- 每一行一个规格，用竖线隔开：

```text
编号 | SKU code | 款式名 | 美元价格 | 图片网址（可以不写）
4 | PETAL-4 | Five-petal blossom | 4.80
17 | PETAL-17 | Blush garden rose | 6.90 | https://你的图片
1S | SH01-S | Shape 01 small | 3.50
```

编号就是顾客一次输入很多个时用的。例如输入 `4 5 7 9`，会一起加入购物袋。购物车和订单里按商品名字母排序，同一个商品里按编号从小到大（1、2、6、10、17，不是 1、10、17、2）。

编辑商品时，没写进文本框的旧规格会被隐藏，不会删掉，这样老订单还能再加入购物袋。

## 6. 有人下单时发邮件给你

Admin → **Alerts**。

比较稳的做法：

1. 打开 [ntfy.sh](https://ntfy.sh)，订阅一个很长、别人猜不到的主题。
2. 在这个主题上打开邮件通知，填你的邮箱。
3. Webhook 填 `https://ntfy.sh/你的主题`，Your email 也填你的邮箱。
4. 保存，点 **Send a test**。
5. 如果提示要启用 `pg_net`：Supabase → **Database** → **Extensions**，打开 **pg_net**，再回 SQL Editor 把 `supabase.sql` 运行一次。

只填邮箱、不填 Webhook 也可以。第一次你会收到 FormSubmit 的确认信，点开之后，以后的新订单才会发到邮箱。请也看一下垃圾箱。

邮件发不出去也不会影响顾客下单。

## 7. 建议自己走一遍

用另一个邮箱注册，不要用管理员邮箱。

1. 商店里点一个商品，输入多个编号，看购物袋是否按「商品名 → 编号」排好。
2. 结账时地址顺序是：国家 / 地区、州/省、**街道**、城市、邮编。
3. 提交后应看到 “Thank you for choosing me.”，旁边可以进订单详情。
4. 个人中心能看到日期、订单号、件数、商品标价、状态。状态还是 Pending review 时可以取消，你在后台改成别的状态后就不能取消。
5. 后台把订单改成 **Arrived**。顾客打开订单，会要求确认地址；不确认就不继续。确认后看到邮费；你还没填就是 **Pending calculation**。
6. 你在后台填邮费，再把状态改成 **Shipped**，这时必须填快递单号。顾客的订单详情里能看到单号。
7. 顾客可以在历史订单里把某一款再加入购物袋。

首页只显示最新上传的 6 个商品。全部商品在 Shop 页，有两级分类。
