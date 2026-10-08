# Benchmark samples (unedited model output)

Model: Hy-MT2-7B Q4_K_M on this laptop's Arc 140V through llama-server (llama.cpp b11510, Vulkan). Source passages are public-domain book openings, because the Library was empty; the owner's own passages have not been run yet.

- **A** = plain prompt: English instruction asking to keep English names, previous paragraph as background. No name handling.

- **B** = final approach: names masked with placeholders before translation and restored after, previous paragraph as background context (model card 'Structured Data 2' template).

The source text is shown first, then A, then B, for each paragraph. Judge the Chinese for accuracy, naturalness and whether names behave as you want.


## Pride and Prejudice, ch.1 (a page of 9 paragraphs)

**Source:** It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

**A:** 一个公认的真理是：拥有巨额财富的单身男子，必定需要一位妻子。

**B:** 众所周知，一个家境优渥的单身男子，必定会想要找位妻子。

**Source:** However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.

**A:** 无论这样的男子初到某个社区时，其想法和观点有多不为人知，这一观念在周边家庭的脑海中早已根深蒂固——他们总认为这名男子理应成为他们某个女儿的丈夫。

**B:** 无论这样的男子在初到某个社区时，其想法和观点有多么不为人知，这一观念在周边家庭的头脑中早已根深蒂固，他们总认为他是他们某个女儿理所应当的配偶。

**Source:** “My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”

**A:** “亲爱的班纳特先生，”有一天他的夫人对他说，“您听说内瑟菲尔德庄园终于租出去了吗？”

**B:** “亲爱的Bennet先生，”有一天他的妻子对他说，“您听说了吗？Netherfield Park终于有人租下去了。”

**Source:** Mr. Bennet replied that he had not.

**A:** 班纳特先生回答说他还没听说。

**B:** Bennet先生回答说他还没听说。

**Source:** “But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”

**A:** “但事实就是如此，”她回答道，“因为朗夫人刚刚来过这里，她把一切都告诉了我。”

**B:** “但事实就是如此，”她回答道，“因为Long夫人刚刚来过这里，她把一切都告诉了我。”

**Source:** Mr. Bennet made no answer.

**A:** 贝内特先生没有回答。

**B:** Bennet先生没有回答。

**Source:** “Do you not want to know who has taken it?” cried his wife impatiently.

**A:** “你就不想知道是谁拿走了它吗？”他的妻子不耐烦地叫道。

**B:** “你难道不想知道是谁拿走了它吗？”他的妻子不耐烦地叫道。

**Source:** “You want to tell me, and I have no objection to hearing it.” This was invitation enough.

**A:** “你想告诉我，我并不反对听。”这已算是邀请了。

**B:** “你想告诉我，我并不反对听。”这已算是足够的邀请了。

**Source:** “Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it, that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week.”

**A:** “亲爱的，你一定要知道——朗夫人说，尼瑟菲尔德已经被一位来自英格兰北部的富家青年看中了；他周一坐着四马马车前来考察那处房产，对它极为满意，于是立刻与莫里斯先生达成了协议；他打算在米迦勒节之前入住，而他的部分仆人也将在下周末前赶到家中。”

**B:** “亲爱的，你一定要知道——Long夫人说，Netherfield已经被England北部一位家境殷实的年轻人看中了；他坐着四马拖车的马车来到Monday，看到这里后极为满意，立刻就与Morris先生达成了协议；他将在Michaelmas之前入住，他的部分仆人也将在下周末前赶到家中。”


## Moby-Dick, ch.1

**Source:** Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.

**A:** 叫我以实玛利吧。几年前——具体时间已记不清了——我身上几乎没有钱，岸上也没有什么让我感兴趣的东西，于是便决定出海航行，去看看这个世界上的水域。

**B:** 叫我Ishmael吧。几年前——具体时间已记不清了——我的钱包里几乎没有钱，岸上也没有什么让我感兴趣的东西，于是我决定出海航行，去看看这个世界上的水域。


## The Time Machine, ch.1

**Source:** The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us. His grey eyes shone and twinkled, and his usually pale face was flushed and animated. The fire burned brightly, and the soft radiance of the incandescent lights in the lilies of silver caught the bubbles that flashed and passed in our glasses.

**A:** 那位时间旅行者（为方便起见，我们就这样称呼他）正在向我们阐述一项深奥的道理。他灰色的眼睛闪闪发亮，平日里苍白的脸庞也变得红润而有生气。火焰燃烧得十分旺盛，银色灯罩发出的柔和光线照亮了我们杯中不断闪现的气泡。

**B:** Time Traveller（这样称呼他会更方便）正在向我们阐述一件深奥的道理。他灰色的眼睛闪闪发亮，平日里苍白的脸庞也变得红润而有生气。火焰燃烧得十分旺盛，银色灯罩发出的柔和光芒照亮了我们杯中不断闪烁的气泡。


## Walden, Economy

**Source:** When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only.

**A:** 在撰写这些文字时，或者更确切地说，是在撰写其中的大部分内容时，我独自一人住在森林里，距离最近的邻居也有了一英里远。那是一座我自己建造的房子，位于马萨诸塞州康科德市的瓦尔登池塘岸边。我完全依靠自己的劳动来维持生计。

**B:** 在撰写以下这些页面，或者更确切地说，是其中的大部分内容时，我独自一人住在森林里，距离最近的邻居也有一英里远。那是一座我亲自建造的房子，位于Walden Pond的岸边，属于Concord、Massachusetts地区。我完全依靠自己的劳动来维持生计。
